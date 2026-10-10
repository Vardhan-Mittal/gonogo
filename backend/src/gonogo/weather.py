"""Live rainfall from Open-Meteo (free, no key), one batched call for all spots."""
import json
import urllib.parse
import urllib.request

URL = "https://api.open-meteo.com/v1/forecast"


def rain_windows(spot_list):
    """Return {spot_id: (r1, r3, f1)} in mm for every spot.

    With past_hours=3 and forecast_hours=2 Open-Meteo returns five hourly
    values: three past hours, the current hour and the next hour.
    """
    params = {
        "latitude": ",".join(str(s["lat"]) for s in spot_list),
        "longitude": ",".join(str(s["lon"]) for s in spot_list),
        "hourly": "precipitation",
        "past_hours": 3,
        "forecast_hours": 2,
        "timezone": "Asia/Kolkata",
    }
    with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(params)}", timeout=15) as resp:
        body = json.loads(resp.read())
    if isinstance(body, dict):
        body = [body]
    out = {}
    for sp, loc in zip(spot_list, body):
        v = [x or 0.0 for x in loc["hourly"]["precipitation"]]
        out[sp["id"]] = (v[3], sum(v[1:4]), v[4])
    return out
