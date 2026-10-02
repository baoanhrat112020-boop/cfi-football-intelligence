import os, sys
from pathlib import Path
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: set $env:SB_SERVICE_ROLE_KEY")
    sys.exit(1)

if len(sys.argv) < 2:
    print("Usage: python scripts/run_sql.py <file.sql>")
    sys.exit(1)

sql_path = Path(sys.argv[1])
if not sql_path.exists():
    print(f"ERROR: file not found: {sql_path}")
    sys.exit(1)

sql_content = sql_path.read_text(encoding="utf-8")
print(f"Running: {sql_path.name} ({len(sql_content)} bytes)")

sb = create_client(SB_URL, SB_KEY)
try:
    r = sb.rpc("exec_sql", {"sql": sql_content}).execute()
    print("OK - SQL executed")
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)
