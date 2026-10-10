"""Lambda entry points: the HTTP API and the 15-minute risk engine."""
import base64
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from . import data, metrics, risk, telegram, weather
from .store import get_store

IST = timezone(timedelta(hours=5, minutes=30))
REPORT_TTL_S = 60 * 60  # a photo report overrides the forecast for an hour
REPORT_PER_SPOT_S = 30  # at most one photo per spot every 30 s
REPORT_PER_HOUR = 200   # and 200 photos per hour in total (Bedrock cost cap)


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
    changed, levels, sent = [], [], 0
    for sp in spot_list:
        r1, r3, f1 = windows[sp["id"]]
        status = risk.assess(sp, r1, r3, f1, _fresh_report_depth(store, sp["id"]))
        store.put_status(sp["id"], status)
        levels.append(status["level"])
        if risk.is_worse(status["level"], (previous.get(sp["id"]) or {}).get("level")):
            changed.append(sp["id"])
            sent += telegram.notify_change(store, sp["id"], status)
    metrics.emit(NoGoSpots=levels.count(risk.NO_GO), RiskySpots=levels.count(risk.RISKY),
                 SpotsWorsened=len(changed), AlertsSent=sent)
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


def submit_report(store, body, save_photo=None, dispatch=None, estimate=None):
    """Accept a photo report and hand the slow model call to a worker.

    API Gateway gives up after 30 s and a vision call can take longer, so on
    AWS the photo goes to S3 and a worker Lambda is invoked asynchronously;
    the client polls GET /reports/<id>. Locally (no dispatch) it runs inline.
    """
    sp = data.spot(body.get("spot", ""))
    image = body.get("image", "")
    if sp is None or not image:
        return 400, {"error": "spot and image are required"}
    if len(image) > 7_000_000:
        return 413, {"error": "image too large; resize to 1280px before upload"}
    media_type = body.get("media_type", "image/jpeg")
    if media_type not in ("image/jpeg", "image/png"):
        return 400, {"error": "photo must be JPEG or PNG"}

    now = datetime.now(IST)
    limited = store.take_report_slot(sp["id"], int(now.timestamp()), REPORT_PER_SPOT_S, REPORT_PER_HOUR)
    if limited:
        return 429, {"error": limited}
    job = {"id": uuid.uuid4().hex, "spot": sp["id"], "state": "pending",
           "time": now.isoformat(timespec="seconds"), "epoch": int(now.timestamp())}
    store.put_job(job)
    task = {"job_id": job["id"], "spot": sp["id"], "media_type": media_type}
    if save_photo:
        task["photo_key"] = save_photo(sp["id"], job["time"], image, media_type)
    else:
        task["image"] = image

    if dispatch:
        dispatch(task)
    else:
        process_report(store, task, estimate=estimate)
    return 202, store.get_job(job["id"])


def process_report(store, task, estimate=None, load_photo=None):
    """Estimate depth for one queued report, then update the spot and alert."""
    job = store.get_job(task["job_id"])
    sp = data.spot(task["spot"])
    try:
        image = task.get("image") or load_photo(task["photo_key"])
        if estimate is None:
            from . import vision
            estimate = vision.estimate_depth
        result = estimate(image, task["media_type"])
    except Exception as exc:
        print(f"report {task['job_id']} failed: {exc!r}")
        store.put_job({**job, "state": "error", "error": "Could not check this photo. Please try again."})
        return

    report = {**result, "spot": sp["id"], "time": job["time"], "epoch": job["epoch"],
              "photo_key": task.get("photo_key")}
    store.put_report(sp["id"], report)

    # Re-assess this spot straight away with the photo taken into account.
    prev = store.statuses().get(sp["id"]) or {}
    status = risk.assess(sp, prev.get("rain_1h_mm", 0.0), prev.get("rain_3h_mm", 0.0),
                         prev.get("forecast_1h_mm", 0.0), _fresh_report_depth(store, sp["id"]))
    store.put_status(sp["id"], status)
    sent = 0
    if risk.is_worse(status["level"], prev.get("level")):
        sent = telegram.notify_change(store, sp["id"], status)
    metrics.emit(PhotoReports=1, PhotoDepthInches=float(result.get("depth_inches") or 0), AlertsSent=sent)
    store.put_job({**job, "state": "done", "report": report, "status": status})


def _save_photo_s3(spot_id, ts, image_b64, media_type):
    import boto3

    bucket = os.environ["PHOTO_BUCKET"]
    ext = "png" if media_type == "image/png" else "jpg"
    key = f"reports/{spot_id}/{ts.replace(':', '-')}-{uuid.uuid4().hex[:6]}.{ext}"
    boto3.client("s3").put_object(Bucket=bucket, Key=key, Body=base64.b64decode(image_b64), ContentType=media_type)
    return key


def _load_photo_s3(key):
    import boto3

    obj = boto3.client("s3").get_object(Bucket=os.environ["PHOTO_BUCKET"], Key=key)
    return base64.b64encode(obj["Body"].read()).decode()


def _dispatch_lambda(task):
    import boto3

    boto3.client("lambda").invoke(FunctionName=os.environ["REPORT_WORKER_FUNCTION"],
                                  InvocationType="Event", Payload=json.dumps(task).encode())


def report_worker_handler(event, context):
    process_report(get_store(), event, load_photo=_load_photo_s3)


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
        on_aws = bool(os.environ.get("REPORT_WORKER_FUNCTION"))
        return submit_report(store, body_fn(), save_photo=_save_photo_s3 if on_aws else None,
                             dispatch=_dispatch_lambda if on_aws else None)
    if method == "GET" and len(parts) == 2 and parts[0] == "reports":
        job = store.get_job(parts[1])
        return (200, job) if job else (404, {"error": "unknown report"})
    if method == "POST" and parts == ["refresh"] and os.environ.get("ALLOW_REFRESH") == "1":
        # Local runs only; on AWS, EventBridge Scheduler runs the engine.
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
