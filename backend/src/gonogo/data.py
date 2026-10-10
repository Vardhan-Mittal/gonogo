"""Static data (spots, historical storms) and storm replay."""
import json
import math
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

from . import risk

_DATA = Path(__file__).parent / "data"


@lru_cache(maxsize=None)
def spots():
    return json.loads((_DATA / "spots.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def storms():
    return json.loads((_DATA / "storms.json").read_text(encoding="utf-8"))


def spot(spot_id):
    return next((s for s in spots() if s["id"] == spot_id), None)


def storm(storm_id):
    return next((s for s in storms() if s["id"] == storm_id), None)


def _km(lat1, lon1, lat2, lon2):
    dy = (lat2 - lat1) * 111.0
    dx = (lon2 - lon1) * 111.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def rain_factor(st, sp):
    """How much of the reference station's rain fell at this spot.

    Inverse-distance-weighted (power 2) interpolation of the storm's IMD
    station totals, divided by the reference station's total.
    """
    stations = st.get("stations")
    if not stations:
        return 1.0
    num = den = 0.0
    for s in stations:
        d = max(_km(sp["lat"], sp["lon"], s["lat"], s["lon"]), 0.5)
        w = 1.0 / d ** 2
        num += w * s["mm"]
        den += w
    return round(num / den / st["reference_mm"], 3)


def _steps(st, start, base, with_forecast):
    steps = []
    factors = {sp["id"]: rain_factor(st, sp) for sp in spots()}
    for i in range(len(base)):
        statuses = {}
        for sp in spots():
            series = [v * factors[sp["id"]] for v in base]
            f1 = series[i + 1] if with_forecast and i + 1 < len(series) else 0.0
            statuses[sp["id"]] = risk.assess(
                sp, risk.window_sum(series, i, 1), risk.window_sum(series, i, 3), f1
            )
        steps.append({
            "time": (start + timedelta(hours=i)).isoformat(timespec="minutes"),
            "rain_mm": base[i],
            "statuses": statuses,
        })
    return steps, factors


def replay(storm_id):
    """Run the risk model hour by hour over a historical storm.

    Two runs: one where the next hour's observed rain stands in for a
    1-hour rain forecast (what a good nowcast would have shown), and one
    with rain gauges only (no forecast at all), so the claim can be checked.
    """
    st = storm(storm_id)
    if st is None:
        return None
    start = datetime.fromisoformat(st["start"])
    base = st["rain_mm_per_hour"]
    steps, factors = _steps(st, start, base, with_forecast=True)
    gauge_steps, _ = _steps(st, start, base, with_forecast=False)
    for s, g in zip(steps, gauge_steps):
        s["statuses_gauge_only"] = g["statuses"]
    meta = {k: st[k] for k in ("id", "title", "title_hi", "station", "note", "sources")}
    meta["stations_source"] = st.get("stations_source")
    return {
        "storm": meta,
        "spot_rain_factor": factors,
        "steps": steps,
        "validation": validate(st, steps),
    }


def validate(st, steps):
    """For each spot the news reported flooded, when did GoNoGo first say NO_GO?

    Lead time is measured against the hour of heaviest rain at the reference
    station, since the news reports don't give the exact time each spot flooded.
    """
    peak = max(steps, key=lambda s: s["rain_mm"])["time"]

    def first(key, spot_id):
        return next((s["time"] for s in steps if s[key][spot_id]["level"] == risk.NO_GO), None)

    def lead_h(t):
        if t is None:
            return None
        return round((datetime.fromisoformat(peak) - datetime.fromisoformat(t)).total_seconds() / 3600, 1)

    results = []
    for rep in st["reported_flooded"]:
        f = first("statuses", rep["spot"])
        g = first("statuses_gauge_only", rep["spot"])
        results.append({"spot": rep["spot"], "source": rep["source"],
                        "first_no_go": f, "first_no_go_gauge_only": g,
                        "hours_before_peak": lead_h(f), "hours_before_peak_gauge_only": lead_h(g)})
    total_spots = len(steps[0]["statuses"]) if steps else 0
    peak_step = next(s for s in steps if s["time"] == peak)
    return {
        "reported": len(results),
        "flagged": sum(1 for r in results if r["first_no_go"]),
        "flagged_gauge_only": sum(1 for r in results if r["first_no_go_gauge_only"]),
        "peak_time": peak,
        "no_go_at_peak": sum(1 for v in peak_step["statuses"].values() if v["level"] == risk.NO_GO),
        "total_spots": total_spots,
        "spots": results,
    }
