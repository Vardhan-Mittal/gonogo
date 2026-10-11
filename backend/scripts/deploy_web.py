"""Upload the built website (frontend/dist) to S3 and refresh CloudFront.

    cd frontend && npm run build      (with VITE_API_URL set to the stack's ApiUrl)
    python backend/scripts/deploy_web.py [--stack gonogo] [--region ap-southeast-2]

index.html is served with no-cache so a new deploy shows up at once; the
hashed files under assets/ are cached for a year.
"""
import argparse
import mimetypes
import time
from pathlib import Path

import boto3

DIST = Path(__file__).parents[2] / "frontend" / "dist"
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stack", default="gonogo")
    ap.add_argument("--region", default="ap-southeast-2")
    args = ap.parse_args()

    session = boto3.Session(region_name=args.region)
    outputs = {o["OutputKey"]: o["OutputValue"] for o in
               session.client("cloudformation").describe_stacks(StackName=args.stack)["Stacks"][0]["Outputs"]}
    bucket, dist_id = outputs["WebBucketName"], outputs["WebDistributionId"]
    if not (DIST / "index.html").exists():
        raise SystemExit("Build the frontend first: cd frontend && npm run build")

    s3 = session.client("s3")
    files = [p for p in DIST.rglob("*") if p.is_file()]
    for p in files:
        key = p.relative_to(DIST).as_posix()
        cache = "public, max-age=31536000, immutable" if key.startswith("assets/") else "no-cache"
        s3.upload_file(str(p), bucket, key, ExtraArgs={
            "ContentType": mimetypes.guess_type(key)[0] or "application/octet-stream",
            "CacheControl": cache,
        })
    session.client("cloudfront").create_invalidation(
        DistributionId=dist_id,
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]}, "CallerReference": str(time.time())},
    )
    print(f"Uploaded {len(files)} files to s3://{bucket}; CloudFront refresh started.")
    print("Live at:", outputs["WebUrl"])


if __name__ == "__main__":
    main()
