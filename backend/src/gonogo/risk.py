"""Risk model: turns rainfall into a Safe / Risky / Do-not-enter decision per spot.

Deliberately simple and explainable. The two levels mirror Delhi PWD's own
standard operating procedure for underpasses: start pumps at 6-8 inches of
water, stop traffic if it keeps rising past 8 inches.
"""

SAFE = "SAFE"
RISKY = "RISKY"
NO_GO = "NO_GO"

_ORDER = {SAFE: 0, RISKY: 1, NO_GO: 2}

# (threshold for 1 h of rain, threshold for 3 h of rain) in mm. Low-lying
# structures and spots that flood every year tip over sooner.
_THRESHOLDS = {
    (True, True): (20.0, 40.0),    # perennial underpass / tunnel / basements
    (True, False): (25.0, 50.0),   # perennial road / junction
    (False, True): (30.0, 60.0),   # other underpass / tunnel / basements
    (False, False): (40.0, 80.0),  # other road / junction / street
}
_LOW_LYING = {"underpass", "tunnel", "basements"}

# Water depth (inches) reported from a photo that forces a level.
REPORT_NO_GO_IN = 8.0
REPORT_RISKY_IN = 4.0


def thresholds(spot):
    return _THRESHOLDS[(bool(spot.get("perennial")), spot.get("type") in _LOW_LYING)]


def worse(a, b):
    return a if _ORDER[a] >= _ORDER[b] else b


def is_worse(new, old):
    return _ORDER[new] > _ORDER[old or SAFE]


def level_for_score(score):
    if score >= 1.0:
        return NO_GO
    if score >= 0.5:
        return RISKY
    return SAFE


def assess(spot, r1, r3, f1=0.0, report_depth_in=None):
    """Assess one spot.

    r1: rain in the last hour (mm); r3: rain in the last 3 hours (mm);
    f1: rain expected in the next hour (mm); report_depth_in: latest
    citizen-photo depth estimate in inches, if one is still fresh.
    """
    t1, t3 = thresholds(spot)
    parts = {"observed_1h": r1 / t1, "observed_3h": r3 / t3, "forecast_1h": f1 / t1}
    driver = max(parts, key=parts.get)
    score = parts[driver]
    level = level_for_score(score)

    if report_depth_in is not None:
        if report_depth_in >= REPORT_NO_GO_IN:
            level, driver = NO_GO, "photo_report"
        elif report_depth_in >= REPORT_RISKY_IN and level == SAFE:
            level, driver = RISKY, "photo_report"

    return {
        "level": level,
        "score": round(score, 2),
        "driver": driver,
        "rain_1h_mm": round(r1, 1),
        "rain_3h_mm": round(r3, 1),
        "forecast_1h_mm": round(f1, 1),
        "report_depth_in": report_depth_in,
    }


def window_sum(series, end_idx, hours):
    """Sum of series[end_idx-hours+1 .. end_idx], clipped at the start."""
    start = max(0, end_idx - hours + 1)
    return float(sum(series[start:end_idx + 1]))
