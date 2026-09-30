import json
import sys

from chdb.session import Session

request = json.load(sys.stdin)
action_types = {"String", "Int8", "Enum8('removed'=-1,'added'=1)"}
action_type = request["actionType"]
if action_type not in action_types:
    raise ValueError("Unsupported action type")

session = Session()
try:
    session.query("CREATE DATABASE base")
    session.query(f"""CREATE TABLE base.events (
        log_id String, block_number UInt64, block_hash String,
        block_timestamp DateTime64(6, 'UTC'), transaction_hash String,
        log_index UInt32, address String, event_signature String,
        parameters Map(String, String), action {action_type}
    ) ENGINE=Memory""")
    rows = "\n".join(json.dumps(row) for row in request["rows"])
    session.query("INSERT INTO base.events FORMAT JSONEachRow\n" + rows)
    result = session.query(request["sql"], "JSON")
    print(json.dumps(json.loads(str(result))["data"]))
finally:
    session.close()
