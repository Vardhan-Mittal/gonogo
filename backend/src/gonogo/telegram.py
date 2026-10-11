"""Telegram bot: alerts out, /start /stop /status in.

Subscribing works through a deep link from the web app:
  https://t.me/<bot>?start=<lang>-<spot>-<spot>...   e.g.  hi-minto-zakhira
"""
import json
import os
import urllib.request

from . import data, risk

_LEVEL = {
    "en": {risk.SAFE: "🟢 SAFE", risk.RISKY: "🟡 RISKY", risk.NO_GO: "🔴 DO NOT ENTER"},
    "hi": {risk.SAFE: "🟢 सुरक्षित", risk.RISKY: "🟡 जोखिम", risk.NO_GO: "🔴 प्रवेश न करें"},
}
_ADVICE = {
    "en": {
        risk.SAFE: "Water levels expected to stay low.",
        risk.RISKY: "Water may reach 6 inches. Two-wheelers should avoid it; cars go slowly.",
        risk.NO_GO: "Water likely above 8 inches (PWD stop-traffic level). Take another route. Never drive into standing water.",
    },
    "hi": {
        risk.SAFE: "पानी कम रहने की उम्मीद है।",
        risk.RISKY: "6 इंच तक पानी भर सकता है। दोपहिया वाहन न जाएं, कार धीरे चलाएं।",
        risk.NO_GO: "8 इंच से ज़्यादा पानी का ख़तरा (PWD ट्रैफ़िक रोकने का स्तर)। दूसरा रास्ता लें। भरे पानी में गाड़ी न डालें।",
    },
}


def _token():
    return os.environ.get("TELEGRAM_BOT_TOKEN", "")


def send(chat_id, text):
    if not _token():
        print(f"[telegram disabled] to {chat_id}: {text}")
        return False
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{_token()}/sendMessage",
        data=json.dumps({"chat_id": chat_id, "text": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status == 200


def format_alert(spot, status, lang="en", replay_label=None):
    lang = lang if lang in _LEVEL else "en"
    name = spot["name_hi"] if lang == "hi" else spot["name"]
    lines = []
    if replay_label:
        lines.append(("⏪ रीप्ले: " if lang == "hi" else "⏪ REPLAY: ") + replay_label)
    lines.append(f"{_LEVEL[lang][status['level']]}: {name}")
    if status.get("driver") == "photo_report":
        depth = status.get("report_depth_in")
        lines.append(f"📷 नागरिक फ़ोटो: ~{depth} इंच पानी" if lang == "hi" else f"📷 Citizen photo: ~{depth} in of water")
    else:
        lines.append(
            f"🌧 पिछले 1 घंटे में {status['rain_1h_mm']} मिमी, अगले घंटे {status['forecast_1h_mm']} मिमी"
            if lang == "hi"
            else f"🌧 {status['rain_1h_mm']} mm in the last hour, {status['forecast_1h_mm']} mm expected next hour"
        )
    lines.append(_ADVICE[lang][status["level"]])
    return "\n".join(lines)


def notify_change(store, spot_id, status, replay_label=None):
    """Alert every subscriber watching this spot. Returns the number sent.

    Replay alerts (past storms) only go to chats that opted in with /demo,
    so nobody can use the public replay endpoint to spam real subscribers.
    """
    sp = data.spot(spot_id)
    sent = 0
    for sub in store.subscribers():
        if replay_label and not sub.get("replay"):
            continue
        if spot_id in sub["spots"]:
            try:
                send(sub["chat_id"], format_alert(sp, status, sub.get("lang", "en"), replay_label))
                sent += 1
            except Exception as exc:  # one bad chat must not stop the rest
                print(f"telegram send failed for {sub['chat_id']}: {exc}")
    try:  # email subscribers via Amazon SNS (filtered by spot, language, kind)
        from . import email_alerts
        sent += email_alerts.publish(spot_id, status, replay_label)
    except Exception as exc:
        print(f"email alert publish failed for {spot_id}: {exc}")
    return sent


def parse_start_payload(payload):
    parts = [p for p in (payload or "").split("-") if p]
    lang = "en"
    if parts and parts[0] in ("en", "hi"):
        lang = parts.pop(0)
    spot_ids = [p for p in parts if data.spot(p)]
    return lang, spot_ids


def handle_update(store, update):
    """Handle one Telegram webhook update."""
    msg = update.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    text = (msg.get("text") or "").strip()
    if not chat_id:
        return
    if text.startswith("/start"):
        lang, spot_ids = parse_start_payload(text[len("/start"):].strip())
        if not spot_ids:
            send(chat_id, "Open GoNoGo, pick the spots on your route and tap 'Get Telegram alerts'.\n"
                          "GoNoGo खोलें, अपने रास्ते के स्पॉट चुनें और 'Telegram अलर्ट' दबाएं।")
            return
        existing = store.subscriber(chat_id) or {}
        store.subscribe(chat_id, spot_ids, lang, replay=existing.get("replay", False))
        names = ", ".join((data.spot(s)["name_hi"] if lang == "hi" else data.spot(s)["name"]) for s in spot_ids)
        send(chat_id, (f"✅ आप इन जगहों के अलर्ट पाएंगे: {names}\n/status – अभी की स्थिति, /stop – बंद करें, "
                       "/demo – पुरानी बारिश के रीप्ले अलर्ट भी पाएं"
                       if lang == "hi" else
                       f"✅ You'll get alerts for: {names}\n/status – current status, /stop – unsubscribe, "
                       "/demo – also get alerts from past-storm replays"))
    elif text.startswith("/demo"):
        sub = store.subscriber(chat_id)
        if not sub:
            send(chat_id, "Subscribe from the GoNoGo site first. / पहले GoNoGo साइट से सब्सक्राइब करें।")
            return
        on = not sub.get("replay", False)
        store.subscribe(chat_id, sub["spots"], sub.get("lang", "en"), replay=on)
        send(chat_id, ("⏪ Replay alerts ON: storm replays on the site will message you. Send /demo again to turn off."
                       if on else "Replay alerts OFF. You'll only get live alerts."))
    elif text.startswith("/stop"):
        store.unsubscribe(chat_id)
        send(chat_id, "Unsubscribed. / अलर्ट बंद।")
    elif text.startswith("/status"):
        sub = store.subscriber(chat_id)
        if not sub:
            send(chat_id, "You're not subscribed yet. / आपने अभी सब्सक्राइब नहीं किया है।")
            return
        statuses = store.statuses()
        lines = []
        for sid in sub["spots"]:
            st = statuses.get(sid)
            lines.append(format_alert(data.spot(sid), st, sub["lang"]) if st else f"{data.spot(sid)['name']}: no data yet")
        send(chat_id, "\n\n".join(lines))
