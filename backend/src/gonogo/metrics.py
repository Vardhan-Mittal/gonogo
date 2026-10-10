"""Custom CloudWatch metrics via the Embedded Metric Format.

Lambda ships stdout to CloudWatch Logs, and CloudWatch turns log lines in
this shape into metrics, so no PutMetricData call or extra IAM is needed.
"""
import json
import time

NAMESPACE = "GoNoGo"


def emit(**values):
    print(json.dumps({
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": NAMESPACE,
                "Dimensions": [["Service"]],
                "Metrics": [{"Name": k, "Unit": "None" if k.endswith("Inches") else "Count"} for k in values],
            }],
        },
        "Service": "gonogo",
        **values,
    }))
