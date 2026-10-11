"""Email alerts through Amazon SNS, for people who don't use Telegram.

One SNS topic. Each email subscription carries a filter policy on message
attributes, so it only receives the spots, language and kind (live or replay)
that person chose. SNS sends the opt-in confirmation and the unsubscribe link.
"""
import json
import os
import re

from . import data

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
MAX_SPOTS = 10

_LEVEL_EN = {"SAFE": "Safe", "RISKY": "Risky", "NO_GO": "DO NOT ENTER"}


def topic_arn():
    return os.environ.get("ALERT_TOPIC_ARN", "")


def _sns():
    import boto3
    return boto3.client("sns")


def subscribe(email, spot_ids, lang, replay):
    """Create a filtered email subscription. SNS emails a confirmation link."""
    policy = {"spot": spot_ids, "lang": [lang], "kind": ["live", "replay"] if replay else ["live"]}
    _sns().subscribe(
        TopicArn=topic_arn(), Protocol="email", Endpoint=email, ReturnSubscriptionArn=True,
        Attributes={"FilterPolicy": json.dumps(policy), "FilterPolicyScope": "MessageAttributes"},
    )


def subject(spot, status, replay_label=None):
    # SNS subjects must be ASCII and under 100 characters.
    prefix = "GoNoGo replay" if replay_label else "GoNoGo alert"
    text = f"{prefix}: {_LEVEL_EN[status['level']]} - {spot['name']}"
    return text.encode("ascii", "ignore").decode()[:99]


def publish(spot_id, status, replay_label=None):
    """Publish one message per language; SNS fans out to matching subscribers."""
    if not topic_arn():
        return 0
    from . import telegram  # message wording is shared with Telegram

    sp = data.spot(spot_id)
    sns = _sns()
    for lang in ("en", "hi"):
        body = telegram.format_alert(sp, status, lang, replay_label)
        body += ("\n\nhttps://dq1ucov7xi7l8.cloudfront.net" if lang == "en"
                 else "\n\nलाइव मैप: https://dq1ucov7xi7l8.cloudfront.net")
        sns.publish(
            TopicArn=topic_arn(), Subject=subject(sp, status, replay_label), Message=body,
            MessageAttributes={
                "spot": {"DataType": "String", "StringValue": spot_id},
                "lang": {"DataType": "String", "StringValue": lang},
                "kind": {"DataType": "String", "StringValue": "replay" if replay_label else "live"},
            },
        )
    return 1
