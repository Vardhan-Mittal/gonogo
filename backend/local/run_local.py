"""Run GoNoGo's real Lambda functions locally with AWS SAM CLI + DynamoDB Local.

    python local/run_local.py            (from backend/, after `sam build`)

- Amazon DynamoDB Local runs in Docker on :8000
- `sam local start-api` serves the API Gateway routes on :3000, each request
  handled by the real Lambda handler inside the AWS Lambda Python 3.12 image
- A scheduler thread calls the risk engine every 15 minutes (EventBridge's job
  when deployed)
- If TELEGRAM_BOT_TOKEN is set, a relay long-polls Telegram and forwards each
  update to the local /telegram route (the deployed version uses a webhook)
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
BACKEND = HERE.parent
API = "http://127.0.0.1:3000"
DDB = "http://127.0.0.1:8000"
TABLE = "gonogo-local"
LOCAL_CREDS = {"AWS_ACCESS_KEY_ID": "local", "AWS_SECRET_ACCESS_KEY": "local", "AWS_DEFAULT_REGION": "ap-south-1"}


def sh(*args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def start_dynamodb_local():
    if "gonogo-ddb" in sh("docker", "ps", "--format", "{{.Names}}").stdout:
        return
    sh("docker", "rm", "-f", "gonogo-ddb")
    out = sh("docker", "run", "-d", "--name", "gonogo-ddb", "-p", "8000:8000", "amazon/dynamodb-local")
    if out.returncode:
        sys.exit(f"Could not start DynamoDB Local (is Docker Desktop running?)\n{out.stderr}")
    time.sleep(3)


def create_table():
    import boto3

    os.environ.update(LOCAL_CREDS)
    ddb = boto3.client("dynamodb", endpoint_url=DDB)
    if TABLE in ddb.list_tables()["TableNames"]:
        return
    ddb.create_table(
        TableName=TABLE, BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}, {"AttributeName": "sk", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
    )


def env_file():
    """Merge secrets from the shell into a git-ignored env file for sam local."""
    env = json.loads((HERE / "env.json").read_text())
    for key in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"):
        if os.environ.get(key):
            env["Parameters"][key] = os.environ[key]
    path = BACKEND / ".aws-sam" / "env.local.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(env))
    return path


def post(path, payload=None, headers=None):
    req = urllib.request.Request(API + path, data=json.dumps(payload or {}).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def scheduler():
    time.sleep(25)  # let sam local warm up
    while True:
        try:
            print("[scheduler] risk engine:", post("/refresh"), flush=True)
        except Exception as exc:
            print("[scheduler] failed:", exc, flush=True)
        time.sleep(15 * 60)


def telegram_relay(token):
    base = f"https://api.telegram.org/bot{token}"
    urllib.request.urlopen(f"{base}/deleteWebhook", timeout=15)
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    offset = 0
    print("[telegram] relay running", flush=True)
    while True:
        try:
            with urllib.request.urlopen(f"{base}/getUpdates?timeout=50&offset={offset}", timeout=60) as resp:
                updates = json.loads(resp.read())["result"]
            for upd in updates:
                offset = upd["update_id"] + 1
                post("/telegram", upd, {"X-Telegram-Bot-Api-Secret-Token": secret})
        except Exception as exc:
            print("[telegram] relay error:", exc, flush=True)
            time.sleep(3)


def main():
    sam = shutil.which("sam") or r"C:\Program Files\Amazon\AWSSAMCLI\bin\sam.cmd"
    start_dynamodb_local()
    create_table()
    print("DynamoDB Local ready on :8000, table", TABLE, flush=True)

    threading.Thread(target=scheduler, daemon=True).start()
    if os.environ.get("TELEGRAM_BOT_TOKEN"):
        threading.Thread(target=telegram_relay, args=(os.environ["TELEGRAM_BOT_TOKEN"],), daemon=True).start()

    cmd = [sam, "local", "start-api", "--port", "3000", "--env-vars", str(env_file()), "--warm-containers", "EAGER"]
    print("Starting:", " ".join(cmd[1:]), flush=True)
    subprocess.run(cmd, cwd=BACKEND, env={**os.environ, **LOCAL_CREDS})


if __name__ == "__main__":
    main()
