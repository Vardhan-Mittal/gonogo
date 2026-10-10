import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

import pytest  # noqa: E402

from gonogo import data, handlers, risk, telegram  # noqa: E402
from gonogo.store import MemoryStore  # noqa: E402


@pytest.fixture
def store():
    return MemoryStore()


@pytest.fixture
def sent(monkeypatch):
    out = []
    monkeypatch.setattr(telegram, "send", lambda chat_id, text: out.append((chat_id, text)) or True)
    return out


def test_levels_follow_thresholds():
    minto = data.spot("minto")  # perennial underpass: 20 mm/h
    assert risk.assess(minto, 5, 5)["level"] == risk.SAFE
    assert risk.assess(minto, 12, 12)["level"] == risk.RISKY
    assert risk.assess(minto, 25, 25)["level"] == risk.NO_GO
    # A road that isn't a known hotspot tolerates more rain.
    assert risk.assess(data.spot("ito"), 25, 25)["level"] == risk.RISKY


def test_forecast_warns_before_the_rain_arrives():
    st = risk.assess(data.spot("minto"), 2, 2, f1=30)
    assert st["level"] == risk.NO_GO and st["driver"] == "forecast_1h"


def test_photo_report_overrides_forecast():
    assert risk.assess(data.spot("ito"), 0, 0, report_depth_in=10)["level"] == risk.NO_GO
    assert risk.assess(data.spot("ito"), 0, 0, report_depth_in=5)["level"] == risk.RISKY


def test_every_storm_flags_its_reported_floods():
    for st in data.storms():
        v = data.replay(st["id"])["validation"]
        assert v["flagged"] == v["reported"] > 0, st["id"]


def test_minto_2020_flagged_before_peak():
    rp = data.replay("2020-07-19")
    first = next(s["time"] for s in rp["steps"] if s["statuses"]["minto"]["level"] == risk.NO_GO)
    peak = max(rp["steps"], key=lambda s: s["rain_mm"])["time"]
    assert first < peak


def test_engine_alerts_only_on_worsening(store, sent):
    store.subscribe(42, ["minto"], "hi")
    dry = {s["id"]: (0.0, 0.0, 0.0) for s in data.spots()}
    wet = {**dry, "minto": (30.0, 40.0, 10.0)}
    handlers.run_engine(store, dry)
    assert sent == []
    assert handlers.run_engine(store, wet)["worsened"] == ["minto"]
    assert len(sent) == 1 and "प्रवेश न करें" in sent[0][1]
    handlers.run_engine(store, wet)  # still bad: no repeat alert
    assert len(sent) == 1


def test_telegram_start_subscribes(store, sent):
    telegram.handle_update(store, {"message": {"chat": {"id": 7}, "text": "/start hi-minto-zakhira-bogus"}})
    assert store.subscriber(7) == {"chat_id": "7", "spots": ["minto", "zakhira"], "lang": "hi"}
    telegram.handle_update(store, {"message": {"chat": {"id": 7}, "text": "/stop"}})
    assert store.subscriber(7) is None


def test_replay_notify_sends_alerts(store, sent):
    store.subscribe(1, ["minto"], "en")
    rp = data.replay("2024-06-28")
    step = next(i for i, s in enumerate(rp["steps"]) if s["statuses"]["minto"]["level"] != risk.SAFE)
    out = handlers.replay_notify(store, "2024-06-28", step)
    assert "minto" in out["worsened"] and out["sent"] == 1
    assert sent[0][1].startswith("⏪ REPLAY")


def test_report_flow(store, sent):
    store.subscribe(1, ["ito"], "en")
    fake = lambda img, mt: {"usable": True, "depth_inches": 14, "confidence": "high",
                            "reference_object": "car tyre", "explanation": "half the tyre"}
    code, out = handlers.submit_report(store, {"spot": "ito", "image": "aGk="}, estimate=fake)
    assert code == 200 and out["status"]["level"] == risk.NO_GO
    assert len(sent) == 1 and "Citizen photo" in sent[0][1]


def test_routes(store):
    assert handlers.route(store, "GET", "/spots", dict)[0] == 200
    assert handlers.route(store, "GET", "/replay/nope", dict)[0] == 404
    assert handlers.route(store, "POST", "/reports", lambda: {"spot": "x"})[0] == 400
