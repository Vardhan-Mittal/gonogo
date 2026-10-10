"""Lambda entry points: the HTTP API and the 15-minute risk engine."""
import base64
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from . import data, risk, telegram, weather
from .store import get_store

IST = timezone(timedelta(hours=5, minutes=30))
REPORT_TTL_S = 60 * 60  # a photo report overrides the forecast for an hour


def _fresh_report_depth(store, spot_id, now=None):
    rep = store.latest_report(spot_id)
    now = now or time.time()
    if rep and rep.get("usable") and now - rep["epoch"] <= REPORT_TTL_S:
        return rep["depth_inches"]
    return None


def run_engine(store, windows=None):
    """Re-assess every spot and alert subscribers about any spot that got worse."""
    spot_list = data.spots()
    windows = windows or weather.rain_windows(spot_list)
    previous = store.statuses()
    changed = []
    for sp in spot_list:
        r1, r3, f1 = windows[sp["id"]]
        status = risk.assess(sp, r1, r3, f1, _fresh_report_depth(store, sp["id"]))
        store.put_status(sp["id"], status)
        if risk.is_worse(status["level"], (previous.get(sp["id"]) or {}).get("level")):
            changed.append(sp["id"])
            telegram.notify_change(store, sp["id"], status)
    return {"assessed": len(spot_list), "worsened": changed}


def engine_handler(event, context):
    result = run_engine(get_store())
    print(json.dumps(result))
    return result


# ---------------------------------------------------------------- HTTP API

def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def _body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    return json.loads(raw)


def get_spots(store):
    return {"spots": data.spots(), "statuses": store.statuses()}


def list_storms():
    return [{k: s[k] for k in ("id", "title", "title_hi", "start")} for s in data.storms()]


def replay_notify(store, storm_id, step):
    """Send the alerts GoNoGo would have sent at this hour of a past storm."""
    rp = data.replay(storm_id)
    if rp is None or not 0 <= step < len(rp["steps"]):
        return None
    cur = rp["steps"][step]
    prev = rp["steps"][step - 1]["statuses"] if step > 0 else {}
    label = f"{rp['storm']['title']} · {cur['time'][11:16]}"
    sent, worsened = 0, []
    for spot_id, st in cur["statuses"].items():
        if risk.is_worse(st["level"], (prev.get(spot_id) or {}).get("level")):
            worsened.append(spot_id)
            sent += telegram.notify_change(store, spot_id, st, replay_label=label)
    return {"worsened": worsened, "sent": sent}


def submit_report(store, body, estimate=None, save_photo=None):
    sp = data.spot(body.get("spot", ""))
    image = body.get("image", "")
    if sp is None or not image:
        return 400, {"error": "spot and image are required"}
    if len(image) > 7_000_000:
        return 413, {"error": "image too large; resize to 1280px before upload"}
    media_type = body.get("media_type", "image/jpeg")

    from . import vision
    result = (estimate or vision.estimate_depth)(image, media_type)
    now = datetime.now(IST)
    report = {**result, "spot": sp["id"], "time": now.isoformat(timespec="seconds"), "epoch": int(now.timestamp())}
    if save_photo:
        report["photo_key"] = save_photo(sp["id"], report["time"], image, media_type)
    store.put_report(sp["id"], report)

    # Re-assess this spot straight away with the photo taken into account.
    prev = store.statuses().get(sp["id"]) or {}
    status = risk.assess(sp, prev.get("rain_1h_mm", 0.0), prev.get("rain_3h_mm", 0.0),
                         prev.get("forecast_1h_mm", 0.0), _fresh_report_depth(store, sp["id"]))
    store.put_status(sp["id"], status)
    if risk.is_worse(status["level"], prev.get("level")):
        telegram.notify_change(store, sp["id"], status)
    return 200, {"report": report, "status": status}


def _save_photo_s3(spot_id, ts, image_b64, media_type):
    import boto3

    bucket = os.environ["PHOTO_BUCKET"]
    ext = "png" if media_type == "image/png" else "jpg"
    key = f"reports/{spot_id}/{ts.replace(':', '-')}-{uuid.uuid4().hex[:6]}.{ext}"
    boto3.client("s3").put_object(Bucket=bucket, Key=key, Body=base64.b64decode(image_b64), ContentType=media_type)
    return key


def route(store, method, path, body_fn, headers=None):
    headers = {k.lower(): v for k, v in (headers or {}).items()}
    parts = [p for p in path.split("/") if p]

    if method == "GET" and parts == ["health"]:
        return 200, {"ok": True}
    if method == "GET" and parts == ["config"]:
        return 200, {"bot_username": os.environ.get("TELEGRAM_BOT_USERNAME", "")}
    if method == "GET" and parts == ["spots"]:
        return 200, get_spots(store)
    if method == "GET" and parts == ["storms"]:
        return 200, list_storms()
    if method == "GET" and len(parts) == 2 and parts[0] == "replay":
        rp = data.replay(parts[1])
        return (200, rp) if rp else (404, {"error": "unknown storm"})
    if method == "POST" and len(parts) == 3 and parts[0] == "replay" and parts[2] == "notify":
        out = replay_notify(store, parts[1], int(body_fn().get("step", -1)))
        return (200, out) if out is not None else (400, {"error": "bad storm or step"})
    if method == "POST" and parts == ["reports"]:
        return submit_report(store, body_fn(), save_photo=_save_photo_s3 if os.environ.get("PHOTO_BUCKET") else None)
    if method == "POST" and parts == ["refresh"]:
        return 200, run_engine(store)
    if method == "POST" and parts == ["telegram"]:
        secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
        if secret and not hmac.compare_digest(headers.get("x-telegram-bot-api-secret-token", ""), secret):
            return 401, {"error": "bad secret"}
        telegram.handle_update(store, body_fn())
        return 200, {"ok": True}
    return 404, {"error": "not found"}


def api_handler(event, context):
    http = event["requestContext"]["http"]
    try:
        status, body = route(get_store(), http["method"], event.get("rawPath", "/"),
                             lambda: _body(event), event.get("headers"))
    except Exception as exc:
        print(f"error handling {http['method']} {event.get('rawPath')}: {exc!r}")
        status, body = 500, {"error": "internal error"}
    return _resp(status, body)
