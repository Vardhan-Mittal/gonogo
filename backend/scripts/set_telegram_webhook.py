"""Point the Telegram bot at the deployed API. Run once after `sam deploy`.

    set TELEGRAM_BOT_TOKEN=...          (from @BotFather)
    set TELEGRAM_WEBHOOK_SECRET=...     (same value passed to sam deploy)
    python scripts/set_telegram_webhook.py [--stack gonogo] [--region ap-southeast-2]

The API URL is read from the CloudFormation stack outputs.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request


def telegram(token, method, payload):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def api_url(stack, region):
    import boto3

    outputs = boto3.client("cloudformation", region_name=region).describe_stacks(StackName=stack)["Stacks"][0]["Outputs"]
    return next(o["OutputValue"] for o in outputs if o["OutputKey"] == "ApiUrl")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stack", default="gonogo")
    ap.add_argument("--region", default="ap-southeast-2")
    args = ap.parse_args()

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not token:
        sys.exit("Set TELEGRAM_BOT_TOKEN first.")

    url = api_url(args.stack, args.region).rstrip("/") + "/telegram"
    print("setWebhook:", telegram(token, "setWebhook", {"url": url, "secret_token": secret, "allowed_updates": ["message"]}))
    print("setMyCommands:", telegram(token, "setMyCommands", {"commands": [
        {"command": "status", "description": "Current status of my spots / मेरी जगहों की स्थिति"},
        {"command": "stop", "description": "Stop alerts / अलर्ट बंद करें"},
    ]}))
    info = telegram(token, "getWebhookInfo", {})["result"]
    print("Webhook now:", urllib.parse.urlsplit(info.get("url", "")).netloc or "(none)",
          "| pending updates:", info.get("pending_update_count"))


if __name__ == "__main__":
    main()
