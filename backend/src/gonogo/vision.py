"""Estimate standing-water depth from a citizen photo with Claude on Amazon Bedrock."""
import json
import os

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


def estimate_depth(image_b64, media_type="image/jpeg"):
    from anthropic import AnthropicBedrockMantle

    client = AnthropicBedrockMantle(aws_region=os.environ.get("BEDROCK_REGION", "us-east-1"))
    response = client.messages.create(
        model=os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-opus-5-5"),
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
        return {"usable": False, "depth_inches": 0, "confidence": "low",
                "reference_object": "", "explanation": "The model declined to assess this image."}
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)
