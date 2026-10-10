"""Estimate standing-water depth from a citizen photo with Claude on Amazon Bedrock.

Primary path: the Anthropic SDK's Bedrock client with structured JSON output.
Fallback: boto3's bedrock-runtime Converse API, parsing JSON from the reply,
so a client or permission mismatch on one path doesn't take the feature down.
"""
import base64
import json
import os
import re

PROMPT = """You are checking a citizen's photo of a possibly waterlogged road or underpass in Delhi.
Estimate the depth of standing water in inches by comparing it with reference objects
of known height visible in the photo: car tyres (~25 in tall, hub ~12 in), two-wheeler
wheels (~22 in), kerbs (~6 in), people's knees (~20 in), auto-rickshaws, bus steps.
If there is no standing water, depth is 0. If the photo is not of a road or you cannot
judge, set usable=false. Be conservative: when unsure between two depths, pick the deeper one,
because underestimating can get someone killed."""

SCHEMA = {
    "type": "object",
    "properties": {
        "usable": {"type": "boolean"},
        "depth_inches": {"type": "number"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "reference_object": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": ["usable", "depth_inches", "confidence", "reference_object", "explanation"],
    "additionalProperties": False,
}

_DECLINED = {"usable": False, "depth_inches": 0, "confidence": "low",
             "reference_object": "", "explanation": "The model declined to assess this image."}


def _model():
    return os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-opus-5-5")


def _region():
    return os.environ.get("BEDROCK_REGION", "us-east-1")


def _via_anthropic_sdk(image_b64, media_type):
    from anthropic import AnthropicBedrockMantle

    client = AnthropicBedrockMantle(aws_region=_region(), timeout=120.0)
    response = client.messages.create(
        model=_model(),
        max_tokens=2000,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    if response.stop_reason == "refusal":
        return dict(_DECLINED)
    return json.loads(next(b.text for b in response.content if b.type == "text"))


def _via_converse(image_b64, media_type):
    import boto3

    client = boto3.client("bedrock-runtime", region_name=_region())
    fmt = "png" if media_type == "image/png" else "jpeg"
    response = client.converse(
        modelId=os.environ.get("BEDROCK_CONVERSE_MODEL_ID", _model()),
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": fmt, "source": {"bytes": base64.b64decode(image_b64)}}},
                {"text": PROMPT + "\n\nReply with only a JSON object with exactly these keys: "
                                  + ", ".join(SCHEMA["required"]) + "."},
            ],
        }],
        inferenceConfig={"maxTokens": 2000},
    )
    text = "".join(c.get("text", "") for c in response["output"]["message"]["content"])
    return parse_json_reply(text)


def parse_json_reply(text):
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return dict(_DECLINED, explanation="Could not read the model's answer.")
    data = json.loads(match.group(0))
    return {
        "usable": bool(data.get("usable", False)),
        "depth_inches": float(data.get("depth_inches", 0) or 0),
        "confidence": data.get("confidence", "low") if data.get("confidence") in ("low", "medium", "high") else "low",
        "reference_object": str(data.get("reference_object", "")),
        "explanation": str(data.get("explanation", "")),
    }


def estimate_depth(image_b64, media_type="image/jpeg"):
    # BEDROCK_MODEL_ID=none skips the Anthropic SDK path, e.g. on accounts
    # where only Amazon models are enabled (Converse with Nova then answers).
    if _model() not in ("", "none"):
        try:
            return _via_anthropic_sdk(image_b64, media_type)
        except Exception as exc:
            print(f"anthropic SDK path failed ({exc!r}); falling back to Converse")
    return _via_converse(image_b64, media_type)
