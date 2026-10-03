"""CFI ETL local config — reads env, exposes Supabase + local Postgres clients."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.environ.get("SUPABASE_SERVICE_KEY", "")
LOCAL_DB_URL: str = os.environ.get(
    "LOCAL_DB_URL",
    "postgresql://cfi:cfi_local_dev@127.0.0.1:15433/cfi_etl",
)


@lru_cache(maxsize=1)
def get_supabase() -> Any:
    """Return a Supabase client bound to the service role key."""
    from supabase import create_client  # imported lazily to keep config import cheap

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in env or .env"
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_local_conn() -> Any:
    """Return a fresh psycopg2 connection to the local Postgres."""
    import psycopg2

    return psycopg2.connect(LOCAL_DB_URL)