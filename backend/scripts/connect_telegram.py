"""Connect a Telegram bot to the deployed GoNoGo stack in one step.

    python scripts/connect_telegram.py

Asks for the bot token (input hidden), looks up the bot's username, makes a
random webhook secret, redeploys the stack with both, then registers the
webhook. Uses your current AWS login (`aws login`).
"""
import getpass
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from set_telegram_webhook import api_url, telegram  # noqa: E402

STACK, REGION = "gonogo", "ap-southeast-2"
BACKEND = Path(__file__).parents[1]


def read_token():
    """Pull the token out of whatever was pasted.

    Terminal pastes into a hidden prompt can carry control characters
    (e.g. a literal Ctrl+V) or arrive twice, so match the token's shape
    instead of trusting the raw input. Never echo the token in errors.
    """
    raw = getpass.getpass("Paste your Telegram bot token (from @BotFather; input is hidden), then Enter: ")
    match = re.search(r"\d{6,12}:[A-Za-z0-9_-]{35}", raw)
    if not match:
        sys.exit("That doesn't look like a bot token (format 123456789:ABC...). Run the script again.")
    return match.group(0)


def main():
    token = read_token()
    try:
        me = telegram(token, "getMe", {})
    except Exception as exc:
        sys.exit(f"Could not reach Telegram with that token ({type(exc).__name__}). Check it and try again.")
    if not me.get("ok"):
        sys.exit("Telegram rejected that token.")
    username = me["result"]["username"]
    secret = secrets.token_urlsafe(24)
    print(f"Bot: @{username}. Redeploying the stack with Telegram settings (2-4 min)...")

    import boto3
    # `aws login` credentials need a region even to refresh themselves.
    creds = boto3.Session(region_name=REGION).get_credentials().get_frozen_credentials()
    env = {**os.environ, "AWS_ACCESS_KEY_ID": creds.access_key, "AWS_SECRET_ACCESS_KEY": creds.secret_key,
           "AWS_SESSION_TOKEN": creds.token or "", "AWS_DEFAULT_REGION": REGION}
    sam = shutil.which("sam") or r"C:\Program Files\Amazon\AWSSAMCLI\bin\sam.cmd"
    overrides = [f"TelegramBotToken={token}", f"TelegramBotUsername={username}", f"TelegramWebhookSecret={secret}"]
    result = subprocess.run(
        [sam, "deploy", "--stack-name", STACK, "--region", REGION, "--resolve-s3", "--capabilities", "CAPABILITY_IAM",
         "--no-confirm-changeset", "--no-fail-on-empty-changeset", "--parameter-overrides", *overrides],
        cwd=BACKEND, env=env, capture_output=True, text=True,
    )
    if result.returncode:
        print(result.stdout[-2000:], result.stderr[-2000:])
        sys.exit("sam deploy failed.")

    url = api_url(STACK, REGION).rstrip("/") + "/telegram"
    print("Webhook:", telegram(token, "setWebhook", {"url": url, "secret_token": secret, "allowed_updates": ["message"]}).get("description"))
    try:  # optional: the command menu shown in Telegram
        telegram(token, "setMyCommands", {"commands": [
            {"command": "status", "description": "Current status of my spots / मेरी जगहों की स्थिति"},
            {"command": "stop", "description": "Stop alerts / अलर्ट बंद करें"},
        ]})
    except Exception as exc:
        print(f"(Skipped the command menu: {type(exc).__name__}. /status and /stop still work.)")
    print(f"Done. Open https://t.me/{username} or use 'Get Telegram alerts' on the site.")


if __name__ == "__main__":
    main()
