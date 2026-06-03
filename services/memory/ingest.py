from __future__ import annotations

import argparse
import json
import os
from typing import Any, List


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to categorized transactions JSON")
    ap.add_argument("--store", required=True, help="OpenViking embedded store path")
    args = ap.parse_args()

    # Keep OpenViking runtime fully inside the workspace (cache/config).
    runtime_home = os.path.join(os.path.dirname(__file__), ".runtime_home")
    os.makedirs(runtime_home, exist_ok=True)
    os.environ["HOME"] = runtime_home
    os.environ["XDG_CACHE_HOME"] = os.path.join(runtime_home, ".cache")

    # Ensure embedded mode has a config file available (workspace-local).
    if not os.environ.get("OPENVIKING_CONFIG_FILE"):
        os.environ["OPENVIKING_CONFIG_FILE"] = os.path.join(os.path.dirname(__file__), "ov.conf")

    from openviking_index import index_transactions

    with open(args.input, "r", encoding="utf-8") as f:
        data: List[Any] = json.load(f)

    os.makedirs(args.store, exist_ok=True)
    index_transactions(data, store_path=args.store)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

