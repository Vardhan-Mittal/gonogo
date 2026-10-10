"""Persistence: one DynamoDB table on AWS, an in-memory dict locally and in tests.

Single-table layout (pk, sk), payload stored as a JSON string in `data`:
  STATUS          / <spotId>        latest live status for a spot
  SUB             / <chatId>        Telegram subscriber {spots, lang}
  REPORT#<spotId> / <iso time>      citizen photo report
"""
import json
import os
import time


class MemoryStore:
    def __init__(self):
        self._items = {}

    def _put(self, pk, sk, data):
        self._items[(pk, sk)] = data

    def _get(self, pk, sk):
        return self._items.get((pk, sk))

    def _query(self, pk):
        return [v for (p, _), v in sorted(self._items.items()) if p == pk]

    def _delete(self, pk, sk):
        self._items.pop((pk, sk), None)

    # --- domain API (shared by both stores) ---
    def statuses(self):
        return {s["spot"]: s for s in self._query("STATUS")}

    def put_status(self, spot_id, status):
        self._put("STATUS", spot_id, {**status, "spot": spot_id, "updated": int(time.time())})

    def subscribe(self, chat_id, spot_ids, lang):
        self._put("SUB", str(chat_id), {"chat_id": str(chat_id), "spots": spot_ids, "lang": lang})

    def unsubscribe(self, chat_id):
        self._delete("SUB", str(chat_id))

    def subscriber(self, chat_id):
        return self._get("SUB", str(chat_id))

    def subscribers(self):
        return self._query("SUB")

    def put_report(self, spot_id, report):
        self._put(f"REPORT#{spot_id}", report["time"], report)

    def latest_report(self, spot_id):
        reports = self._query(f"REPORT#{spot_id}")
        return reports[-1] if reports else None


class DynamoStore(MemoryStore):
    def __init__(self, table_name):
        import boto3

        self._table = boto3.resource("dynamodb").Table(table_name)

    def _put(self, pk, sk, data):
        self._table.put_item(Item={"pk": pk, "sk": sk, "data": json.dumps(data, ensure_ascii=False)})

    def _get(self, pk, sk):
        item = self._table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
        return json.loads(item["data"]) if item else None

    def _query(self, pk):
        from boto3.dynamodb.conditions import Key

        out, kwargs = [], {"KeyConditionExpression": Key("pk").eq(pk)}
        while True:
            page = self._table.query(**kwargs)
            out += [json.loads(i["data"]) for i in page["Items"]]
            if "LastEvaluatedKey" not in page:
                return out
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def _delete(self, pk, sk):
        self._table.delete_item(Key={"pk": pk, "sk": sk})


_store = None


def get_store():
    global _store
    if _store is None:
        table = os.environ.get("TABLE_NAME")
        _store = DynamoStore(table) if table else MemoryStore()
    return _store
