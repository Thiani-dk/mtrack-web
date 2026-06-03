from __future__ import annotations

import glob
import os
from dataclasses import asdict

import pandas as pd

from parser import MpesaParser
from decimal import Decimal
from datetime import datetime


def main() -> int:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
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
    parser = MpesaParser(password="192786")
    txns = parser.parse_pdf(pdf_path)  # parser auto-cleans up

    df = pd.DataFrame([asdict(t) for t in txns])
    print(f"Parsed {len(df)} transactions from: {os.path.basename(pdf_path)}")

    if df.empty:
        print("No transactions extracted.")
        print(f"Shredder: {'OK' if parser._cleanup_ran else 'NOT RUN'}")
        return 0

    # Normalize Date to datetime and filter strictly for 2025 tax year
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])

    start = datetime(2025, 1, 1, 0, 0, 0)
    end = datetime(2025, 12, 31, 23, 59, 59)
    df_2025 = df[(df["Date"] >= start) & (df["Date"] <= end)].copy()

    print(f"2025 window: {start.date()} to {end.date()} | rows: {len(df_2025)}")
    print(f"Shredder: {'OK' if parser._cleanup_ran else 'NOT RUN'}")

    if df_2025.empty:
        print("Wakili note: Hakuna transactions za 2025 kwa hii statement (ama dates haziku-parse).")
        return 0

    # Ensure Amount is Decimal (object) and compute inflows only (Amount > 0)
    df_2025["Amount"] = df_2025["Amount"].apply(lambda x: x if isinstance(x, Decimal) else Decimal(str(x)))
    inflows = df_2025[df_2025["Amount"] > 0].copy()

    # Totals (2025)
    total_inflow_2025 = sum(inflows["Amount"], Decimal("0"))
    defended_safe_2025 = sum(inflows.loc[inflows["FlowTag"] == "Safe", "Amount"], Decimal("0"))
    taxable_rev_2025 = sum(inflows.loc[inflows["FlowTag"] == "Taxable", "Amount"], Decimal("0"))

    # Monthly breakdown
    inflows["Month"] = inflows["Date"].dt.to_period("M").astype(str)  # YYYY-MM
    months = sorted(inflows["Month"].unique().tolist())
    rows = []
    for m in months:
        m_df = inflows[inflows["Month"] == m]
        m_total = sum(m_df["Amount"], Decimal("0"))
        m_safe = sum(m_df.loc[m_df["FlowTag"] == "Safe", "Amount"], Decimal("0"))
        m_tax = sum(m_df.loc[m_df["FlowTag"] == "Taxable", "Amount"], Decimal("0"))
        rows.append({"Month": m, "Total Inflow": m_total, "Defended Safe": m_safe, "Potential Taxable": m_tax})

    out = pd.DataFrame(rows)
    # Find hottest month by taxable revenue
    hottest = out.sort_values(by="Potential Taxable", ascending=False).head(1)

    print("")
    print("=== Wakili Summary (2025 Tax Year) ===")
    print(f"Total Inflow (2025):              KES {total_inflow_2025}")
    print(f"Defended Safe Amount (2025):      KES {defended_safe_2025}")
    print(f"Potential Taxable Revenue (2025): KES {taxable_rev_2025}")
    print("")
    print("Monthly breakdown (inflows only):")
    print(out.to_string(index=False))
    if not hottest.empty:
        hm = hottest.iloc[0]["Month"]
        ht = hottest.iloc[0]["Potential Taxable"]
        print("")
        print(f"Hottest month (Taxable): {hm} | KES {ht} — hapo ndio moto ilikuwa imewaka.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

