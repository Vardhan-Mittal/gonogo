"""Export spots, storms and storm replays as static JSON for the frontend.

The web app falls back to these files when no API URL is configured, so the
replay demo works on a static host even before the AWS backend is reachable.
Run: python export_static.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from gonogo import data  # noqa: E402
from gonogo.handlers import list_storms  # noqa: E402

OUT = Path(__file__).parents[1] / "frontend" / "public" / "static-data"


def write(name, payload):
    (OUT / name).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write("spots.json", {"spots": data.spots(), "statuses": {}})
    write("storms.json", list_storms())
    for st in data.storms():
        write(f"replay-{st['id']}.json", data.replay(st["id"]))
    print(f"wrote static data to {OUT}")
