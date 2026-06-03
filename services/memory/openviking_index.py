from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import date
from decimal import Decimal
from typing import Iterable, Mapping, Optional

import openviking as ov


def _sanitize_details(details: str) -> str:
    """
    Redact common PII patterns before indexing.
    - Phone-like digit runs
    - Transaction-like long numeric IDs
    """
    s = re.sub(r"\b\d{9,}\b", "[REDACTED_NUMBER]", details)
    s = re.sub(r"\b2547\d{8}\b", "[REDACTED_MSISDN]", s)
    s = re.sub(r"\b07\d{8}\b", "[REDACTED_MSISDN]", s)
    return s


def index_transactions(
    transactions: Iterable[Mapping],
    *,
    store_path: str,
    target: str = "kb/transactions",
    reason: str = "M-Pesa transactions (sanitized) for Income Defense retrieval",
) -> dict:
    """
    Index parsed transactions into a local embedded OpenViking store.

    Writes a temporary JSONL file (sanitized) and adds it as a resource.
    """
    os.makedirs(store_path, exist_ok=True)
    client = ov.OpenViking(path=store_path)

    tmp_path: Optional[str] = None
    try:
        client.initialize()
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
            tmp_path = f.name
            for t in transactions:
                dt = t.get("Date")
                if isinstance(dt, date):
                    dt_str = dt.isoformat()
                else:
                    dt_str = str(dt)

                amt = t.get("Amount")
                if isinstance(amt, Decimal):
                    amt_str = str(amt)
                else:
                    amt_str = str(amt)

                payload = {
                    "date": dt_str,
                    "amount_kes": amt_str,
                    "flow_tag": t.get("FlowTag") or t.get("Tag") or "",
                    "details": _sanitize_details(str(t.get("Details", ""))),
                }
                f.write(json.dumps(payload, ensure_ascii=False) + "\n")

        return client.add_resource(
            path=tmp_path,
            target=target,
            reason=reason,
            wait=True,
            summarize=False,
            # Keep this offline-friendly: avoid embedding provider requirements for now.
            build_index=False,
        )
    finally:
        try:
            client.close()
        except Exception:
            pass
        if tmp_path:
            try:
                os.remove(tmp_path)
            except Exception:
                pass

