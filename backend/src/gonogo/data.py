"""Static data (spots, historical storms) and storm replay."""
import json
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


def replay(storm_id):
    """Run the risk model hour by hour over a historical storm.

    The next hour's observed rain stands in for the forecast, which is what a
    good nowcast would have shown at the time.
    """
    st = storm(storm_id)
    if st is None:
        return None
    start = datetime.fromisoformat(st["start"])
    base = st["rain_mm_per_hour"]
    steps = []
    for i in range(len(base)):
        statuses = {}
        for sp in spots():
            factor = st["spot_factor"].get(sp["id"], 1.0)
            series = [v * factor for v in base]
            f1 = series[i + 1] if i + 1 < len(series) else 0.0
            statuses[sp["id"]] = risk.assess(
                sp, risk.window_sum(series, i, 1), risk.window_sum(series, i, 3), f1
            )
        steps.append({
            "time": (start + timedelta(hours=i)).isoformat(timespec="minutes"),
            "rain_mm": base[i],
            "statuses": statuses,
        })
    return {
        "storm": {k: st[k] for k in ("id", "title", "title_hi", "station", "note", "sources")},
        "steps": steps,
        "validation": validate(st, steps),
    }


def validate(st, steps):
    """For each spot the news reported flooded, when did GoNoGo first say NO_GO?"""
    results = []
    for rep in st["reported_flooded"]:
        first = next((s["time"] for s in steps if s["statuses"][rep["spot"]]["level"] == risk.NO_GO), None)
        results.append({"spot": rep["spot"], "source": rep["source"], "first_no_go": first})
    flagged = sum(1 for r in results if r["first_no_go"])
    return {"reported": len(results), "flagged": flagged, "spots": results}
