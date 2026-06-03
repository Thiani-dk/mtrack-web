from __future__ import annotations

import glob
import json
import os
import re
from dataclasses import asdict
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from services.onboarding.persona import MTrackPersona

def _redact_details(details: str) -> str:
    """
    Privacy-first terminal output: redact phone-like numbers and long numeric IDs.
    (Keeps enough context for review without printing full PII.)
    """
    s = str(details or "")
    s = re.sub(r"\b2547\d{8}\b", "2547******[REDACTED]", s)
    s = re.sub(r"\b07\d{8}\b", "07******[REDACTED]", s)
    s = re.sub(r"\b\d{9,}\b", "[REDACTED_NUMBER]", s)
    return s


def _load_manual_corrections(path: str) -> Dict[str, Any]:
    """
    Expected formats (flexible):
    - {"rules": [ { "match": {"contains": "MEGA WINES"}, "category": "Safe|Taxable", "reason": "..." }, ... ]}
    - [ { "match": {"regex": "MEGA.*"}, "category": "...", "reason": "..." }, ... ]
    - {"contains": {"MEGA WINES": {"category":"Taxable","reason":"..."}, ...}}
    """
    if not os.path.exists(path):
        return {"rules": []}

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return {"rules": data}
    if isinstance(data, dict) and isinstance(data.get("rules"), list):
        return data
    if isinstance(data, dict) and isinstance(data.get("contains"), dict):
        rules: List[dict] = []
        for k, v in data["contains"].items():
            rules.append(
                {
                    "match": {"contains": k},
                    "category": v.get("category"),
                    "reason": v.get("reason", "Manual override"),
                }
            )
        return {"rules": rules}
    return {"rules": []}


def _apply_manual_override(details: str, rules: List[dict]) -> Optional[Tuple[str, str]]:
    d = (details or "").lower()
    for r in rules:
        match = (r.get("match") or {}) if isinstance(r, dict) else {}
        category = r.get("category")
        reason = r.get("reason") or "Manual override"
        if not category:
            continue

        contains = match.get("contains")
        if contains and str(contains).lower() in d:
            return str(category), str(reason)

        regex = match.get("regex")
        if regex:
            try:
                if re.search(str(regex), details or "", flags=re.IGNORECASE):
                    return str(category), str(reason)
            except re.error:
                continue
    return None


def _classify_with_reason(
    *,
    details: str,
    amount: Decimal,
    direction: str,
    entity_type: str,
    identifier: Optional[str],
    counterparty: Optional[str],
    manual_rules: List[dict],
    counterparty_out_bias: Dict[str, float],
) -> Tuple[str, str, float, bool]:
    # Manual corrections override everything.
    override = _apply_manual_override(details, manual_rules)
    if override:
        cat, why = override
        return cat, f"Manual correction override: {why}", 0.95, False

    d = (details or "").lower()

    # Government Protocol: Paybill 222222 is safe.
    ident = "" if identifier is None or (isinstance(identifier, float) and pd.isna(identifier)) else str(identifier)
    if ident.strip() == "222222" or "222222" in d:
        return "Safe", "Government Protocol: Paybill 222222 tagged Safe (government/tax payment).", 0.99, False

    # Refund logic via Counterparty History:
    # If this is an IN and counterparty is usually associated with OUT, treat as Safe refund/change.
    if direction == "IN" and counterparty and not (isinstance(counterparty, float) and pd.isna(counterparty)):
        bias = counterparty_out_bias.get(str(counterparty).lower())
        if bias is not None and bias >= 0.7:
            return "Safe", "Refund Logic: IN from a counterparty historically associated with OUT (refund/change).", 0.85, False

    safe_rules = [
        ("okoa", "Flagged as Safe because 'Okoa' implies a credit liability/savings, not revenue."),
        ("loan", "Flagged as Safe because 'Loan' implies liability financing, not revenue."),
        ("fuliza", "Flagged as Safe because Fuliza is credit/overdraft behaviour, not revenue."),
        ("m-shwari", "Flagged as Safe because M-Shwari activity is savings/credit, not revenue."),
        ("kcb m-pesa", "Flagged as Safe because KCB M-Pesa is credit/loan flow, not revenue."),
        ("reversal", "Flagged as Safe because 'Reversal' indicates correction/refund, not revenue."),
        ("reversed", "Flagged as Safe because it's a reversal/correction, not revenue."),
        ("refund", "Flagged as Safe because refunds are not revenue (return of funds)."),
        ("reimbursement", "Flagged as Safe because reimbursements are cost recovery, not revenue."),
        ("salary", "Flagged as Safe because salary is personal income (not business revenue by default)."),
        ("deposit from", "Flagged as Safe because 'Deposit from' suggests personal transfer/capital injection."),
        ("received from", "Flagged as Safe because it's a direct transfer/receipt (personal by default)."),
        ("funds received", "Flagged as Safe because 'Funds received' looks like a transfer, not a sale."),
        ("transfer from", "Flagged as Safe because transfers are not automatically business revenue."),
        ("gift", "Flagged as Safe because 'Gift' is non-trade inflow, not revenue."),
        ("family", "Flagged as Safe because family remittance is not business revenue."),
        ("relative", "Flagged as Safe because remittance is not business revenue."),
        ("unit trust", "Flagged as Safe because Unit Trust/ZIIDI is investment movement, not revenue."),
        ("ziidi", "Flagged as Safe because ZIIDI is investment movement, not revenue."),
    ]

    taxable_rules = [
        ("pay bill", "Flagged as Taxable because Paybill flows often represent business receipts/payments."),
        ("paybill", "Flagged as Taxable because Paybill flows often represent business receipts/payments."),
        ("till", "Flagged as Taxable because Till/Merchant flows imply sales or business payments."),
        ("merchant", "Flagged as Taxable because Merchant Payment implies trade activity."),
        ("lipa na mpesa", "Flagged as Taxable because Lipa na M-Pesa typically indicates commerce."),
        ("c2b", "Flagged as Taxable because C2B suggests customer-to-business payments."),
        ("customer payment", "Flagged as Taxable because customer payment suggests business revenue."),
        ("pos", "Flagged as Taxable because POS is typically merchant activity."),
        ("small business", "Flagged as Taxable because it is explicitly tagged as business payment."),
    ]

    # Business Inflow rule: IN from Merchant should be high-confidence taxable unless refund.
    if direction == "IN" and entity_type == "Merchant":
        return (
            "High Confidence Taxable",
            "Business Inflow: IN from Merchant (Till/Paybill) => High Confidence Taxable (unless refund).",
            0.95,
            False,
        )

    for kw, why in taxable_rules:
        if kw in d:
            return "Taxable", why, 0.9, False
    for kw, why in safe_rules:
        if kw in d:
            return "Safe", why, 0.9, False

    needs_interview = False
    if direction == "IN":
        reason = "Defaulted to Safe: IN without explicit business markers (needs human review if large)."
        conf = 0.7
        if amount > Decimal("10000"):
            conf = 0.5
            needs_interview = True
            reason = "Defaulted to Safe (High-Value): IN > 10k without clear markers; Butler interview needed."
        return "Safe", reason, conf, needs_interview

    return "Taxable", "Defaulted to Taxable: OUT/charge/expense side (not revenue).", 0.7, False


def _is_high_risk_ambiguity(details: str, amount: Decimal) -> bool:
    if amount <= Decimal("10000"):
        return False
    d = (details or "").lower()
    markers = ("paybill", "pay bill", "till", "merchant", "received from", "funds received")
    return not any(m in d for m in markers)


def _validate_transaction_balances(df: pd.DataFrame) -> List[dict]:
    """
    Row-by-row verification that: Previous_Balance + In - Out == Current_Balance
    Returns a list of mismatch dictionaries.
    """
    mismatches = []
    prev_balance = None

    for idx, row in df.iterrows():
        current_balance = row["Balance"]
        direction = str(row.get("Direction", "IN"))
        amount = row["Amount"]

        # Convert to Decimal if needed
        if not isinstance(amount, Decimal):
            amount = Decimal(str(amount))

        # Determine in/out values
        if direction == "IN":
            in_amount = amount
            out_amount = Decimal("0")
        elif direction == "OUT":
            in_amount = Decimal("0")
            out_amount = amount
        else:
            in_amount = Decimal("0")
            out_amount = Decimal("0")

        # Compute expected balance
        if prev_balance is not None:
            expected_balance = Decimal(str(prev_balance)) + in_amount - out_amount
        else:
            expected_balance = in_amount - out_amount

        # Compare with current_balance if both not None
        if pd.notna(current_balance):
            current_bal_decimal = Decimal(str(current_balance))
            if abs(expected_balance - current_bal_decimal) > Decimal("0.01"):
                mismatches.append({
                    "row_index": idx,
                    "expected_balance": expected_balance,
                    "actual_balance": current_bal_decimal,
                    "difference": current_bal_decimal - expected_balance,
                })

        # Update prev_balance for next iteration
        if pd.notna(current_balance):
            prev_balance = str(current_balance)

    return mismatches


def main() -> int:
    repo_root = os.path.abspath(os.path.dirname(__file__))
    samples_dir = os.path.join(repo_root, "data", "samples")
    pdfs = sorted(
        set(
            glob.glob(os.path.join(samples_dir, "**", "*.pdf"), recursive=True)
            + glob.glob(os.path.join(samples_dir, "**", "*.PDF"), recursive=True)
        )
    )
    if not pdfs:
        print("Eii boss, hakuna statement hapa. Drop your M-Pesa PDF kwa `data/samples/` then tu-run tena.")
        return 0

    pdf_path = pdfs[0]

    # Local import so this script can be run from repo root.
    import sys
    sys.path.insert(0, os.path.join(repo_root, "services", "pdf-engine"))
    from parser import MpesaParser  # type: ignore

    parser = MpesaParser(password="192786")
    txns = parser.parse_pdf(pdf_path)

    df = pd.DataFrame([asdict(t) for t in txns])
    if df.empty:
        print("No transactions extracted.")
        print(f"Shredder: {'OK' if getattr(parser, '_cleanup_ran', False) else 'NOT RUN'}")
        return 0

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"]).copy()
    df["Amount"] = df["Amount"].apply(lambda x: x if isinstance(x, Decimal) else Decimal(str(x)))

    # Strict 2025 window
    start = datetime(2025, 1, 1, 0, 0, 0)
    end = datetime(2025, 12, 31, 23, 59, 59)
    df_2025 = df[(df["Date"] >= start) & (df["Date"] <= end)].copy()

    manual_path = os.path.join(repo_root, "manual_corrections.json")
    manual = _load_manual_corrections(manual_path)
    manual_rules = manual.get("rules", [])

    # Build counterparty OUT-bias map for refund logic (history).
    counterparty_out_bias: Dict[str, float] = {}
    if "Counterparty" in df_2025.columns and "Direction" in df_2025.columns:
        grp = df_2025.dropna(subset=["Counterparty"]).groupby(df_2025["Counterparty"].str.lower())
        for name, g in grp:
            total = len(g)
            if total <= 3:
                continue
            out_count = int((g["Direction"] == "OUT").sum())
            counterparty_out_bias[name] = out_count / total

    cats: List[str] = []
    whys: List[str] = []
    hi_risk: List[str] = []
    confs: List[float] = []
    needs: List[bool] = []

    for _, row in df_2025.iterrows():
        details = str(row.get("Details", ""))
        amount = row["Amount"]
        cat, why, conf, needs_interview = _classify_with_reason(
            details=details,
            amount=amount,
            direction=str(row.get("Direction", "IN")),
            entity_type=str(row.get("Entity_Type", "Unknown")),
            identifier=row.get("Identifier"),
            counterparty=row.get("Counterparty"),
            manual_rules=manual_rules,
            counterparty_out_bias=counterparty_out_bias,
        )
        cats.append(cat)
        whys.append(why)
        hi_risk.append("YES" if _is_high_risk_ambiguity(details, amount) else "")
        confs.append(conf)
        needs.append(needs_interview)

    df_2025["AI Category"] = cats
    df_2025["AI Reasoning"] = whys
    df_2025["High-Risk Ambiguity"] = hi_risk
    df_2025["confidence"] = confs
    df_2025["needs_butler_interview"] = needs
    df_2025["Transaction Details"] = df_2025["Details"].apply(_redact_details)

    # Output: detailed table for review (privacy-redacted details)
    out_cols = [
        "Transaction_ID",
        "Date",
        "Time",
        "Direction",
        "Entity_Type",
        "Counterparty",
        "Identifier",
        "Amount",
        "Balance",
        "AI Category",
        "confidence",
        "needs_butler_interview",
        "AI Reasoning",
        "High-Risk Ambiguity",
        "Transaction Details",
    ]
    out_cols = [c for c in out_cols if c in df_2025.columns]
    out = df_2025[out_cols].sort_values(by="Date", ascending=True)

    # Terminal output: show full table if small; otherwise print head and separate high-risk slice.
    print(f"2025 rows: {len(out)} | Shredder: {'OK' if getattr(parser, '_cleanup_ran', False) else 'NOT RUN'}")
    if manual_rules:
        print(f"Manual corrections: loaded {len(manual_rules)} rule(s) from `manual_corrections.json`")
    else:
        print("Manual corrections: none (no `manual_corrections.json` found)")

    pd.set_option("display.max_colwidth", 120)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_rows", 80)

    print("")
    print("=== Judgment Audit Table (2025) ===")
    print(out.to_string(index=False))

    high = out[out["High-Risk Ambiguity"] == "YES"]
    if not high.empty:
        print("")
        print("=== High-Risk Ambiguities (KES > 10,000) ===")
        cols = [c for c in ["Date", "Direction", "Entity_Type", "Counterparty", "Identifier", "Amount", "AI Category", "confidence", "needs_butler_interview", "AI Reasoning", "Transaction Details"] if c in high.columns]
        print(high[cols].to_string(index=False))

    # 2025 Audit Summary (KES totals)
    if "Direction" in df_2025.columns:
        in_df = df_2025[df_2025["Direction"] == "IN"].copy()
        out_df = df_2025[df_2025["Direction"] == "OUT"].copy()
    else:
        in_df = df_2025.copy()
        out_df = df_2025.iloc[0:0].copy()

    total_in = sum(in_df["Amount"], Decimal("0"))
    total_out = sum(out_df["Amount"], Decimal("0"))
    defended_safe = sum(in_df.loc[in_df["AI Category"] == "Safe", "Amount"], Decimal("0"))
    potential_taxable = sum(
        in_df.loc[in_df["AI Category"].isin(["Taxable", "High Confidence Taxable"]), "Amount"],
        Decimal("0"),
    )

    ambiguities = int(df_2025.get("needs_butler_interview", False).sum()) if "needs_butler_interview" in df_2025.columns else 0
    inflow_conf = (
        float(in_df["confidence"].mean()) if "confidence" in in_df.columns and not in_df.empty else 0.0
    )
    confidence_pct = int(round(inflow_conf * 100))

    print("")
    print("=== 2025 Audit Summary (KES) ===")
    print(f"Total_IN (2025):                 KES {total_in}")
    print(f"Total_OUT (2025):                KES {total_out}")
    print(f"Defended Safe Amount (2025):     KES {defended_safe}")
    print(f"Potential Taxable Revenue (2025): KES {potential_taxable}")
    print(f"High-Value Ambiguities (>10k default-safe): {ambiguities}")
    print(f"Confidence (avg on IN rows):     {confidence_pct}%")

    persona = MTrackPersona()
    persona.transition_to_butler()
    print("")
    print("=== Butler Status Line ===")
    print(
        persona.butler_reconciliation_line(
            transaction_count=len(df_2025),
            confidence_pct=confidence_pct,
            high_value_ambiguities=ambiguities,
        )
    )

        # Reconciliation Audit (requires balances)
    if "Balance" in df_2025.columns:
        bal_series = pd.to_numeric(df_2025["Balance"], errors="coerce")
        with_bal = df_2025[~bal_series.isna()].copy()
        if not with_bal.empty:
            with_bal = with_bal.sort_values(by="Date")
            start_bal = Decimal(str(with_bal.iloc[0]["Balance"]))
            final_bal = Decimal(str(with_bal.iloc[-1]["Balance"]))
            recomputed = start_bal + total_in - total_out
            if recomputed != final_bal:
                print("")
                print("⚠️ DATA INTEGRITY BREACH: LEDGER MISMATCH.")
                print(f"Start_Balance={start_bal} + Total_IN={total_in} - Total_OUT={total_out} = {recomputed} != Final_Balance={final_bal}")

            # Row-by-row balance validation
            print("")
            print("=== Row-by-Row Balance Validation ===")
            mismatches = _validate_transaction_balances(with_bal)
            if mismatches:
                print(f"Found {len(mismatches)} balance mismatches:")
                for mismatch in mismatches[:10]:  # Show first 10
                    print(f"  Row {mismatch['row_index']}: Expected KES {mismatch['expected_balance']}, Got KES {mismatch['actual_balance']}, Diff: KES {mismatch['difference']}")
                if len(mismatches) > 10:
                    print(f"  ... and {len(mismatches) - 10} more")
            else:
                print("✅ All row-by-row balances are correct.")
                print("")
                print("✅ AUDIT RECONCILED: DATA INTEGRITY VERIFIED.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

