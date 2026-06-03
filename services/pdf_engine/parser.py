import json
import os
import pdfplumber
import re
from dataclasses import dataclass, asdict
from typing import List, Optional, Any, Dict
from decimal import Decimal
import logging

logger = logging.getLogger("mtrack.pdf_engine")

@dataclass
class Transaction:
    Transaction_ID: str
    Date: str
    Details: str
    Amount: Decimal
    Balance: Decimal
    Type: str
    is_civic: bool = False
    civic_tags: str = ""
    civic_score: float = 0.0
    AI_Category: str = "Personal"
    AI_Reasoning: str = "Personal transaction."

class MpesaParser:
    def __init__(self, rules_path: Optional[str] = None):
        self.re_txn = re.compile(r'([A-Z0-9]{10})\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\s+(.*?)\s+([-]?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})')
        self.rules_path = rules_path or os.path.join(os.path.dirname(__file__), "rules.json")
        self._civic_map = self._load_rules()

    def _load_rules(self) -> dict:
        """Dynamically load classification rules from rules.json.

        Returns dict mapping keyword → [tag, reason].
        Falls back to an empty dict if the file is missing or malformed.
        """
        try:
            with open(self.rules_path, "r") as f:
                rules = json.load(f)
            return rules
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Warning: could not load rules.json ({e}). Using empty rule set.")
            return {}

    def parse_pdf(self, pdf_path: str, password: str = "") -> List[Transaction]:
        transactions = []
        try:
            with pdfplumber.open(pdf_path, password=password) as pdf:
                for page in pdf.pages:
                    text = page.extract_text()
                    if not text: continue
                    for line in text.split("\n"):
                        match = self.re_txn.search(line)
                        if match:
                            ref, dt, desc, amt, bal = match.groups()
                            amt_val = Decimal(amt.replace(",", ""))
                            bal_val = Decimal(bal.replace(",", ""))

                            # Determine transaction type based on description
                            if "Paid to" in desc:
                                txn_type = "Paid"
                            elif "Received from" in desc:
                                txn_type = "Received"
                            else:
                                txn_type = "Received" if amt_val > 0 else "Paid"

                            transactions.append(Transaction(
                                Transaction_ID=ref,
                                Date=dt,
                                Details=desc.strip(),
                                Amount=abs(amt_val),
                                Balance=bal_val,
                                Type=txn_type
                            ))
        except Exception as e:
            print(f"Extraction Error: {e}")
        return self.tag_civic_transactions(transactions)

    def tag_civic_transactions(self, txns):
        """Tag transactions using heuristics from the nested `heuristics` key in rules.json.

        The loaded JSON contains a top‑level `heuristics` dict mapping identifiers to
        `{ "tag": <str>, "reason": <str> }`. Keys are matched case‑insensitively
        against the transaction details. Matching transactions are marked as civic
        with the corresponding tag and reasoning.
        """
        heuristics = self._civic_map.get("heuristics", {})
        for t in txns:
            details_up = t.Details.upper()
            for key, meta in heuristics.items():
                if key.upper() in details_up:
                    t.is_civic = True
                    t.civic_tags = meta.get("tag", "")
                    t.civic_score = 1.0
                    t.AI_Category = meta.get("tag", "")
                    t.AI_Reasoning = meta.get("reason", "")
                    break
        return txns

    def to_ui_dict(self, t: Transaction):
        """Maps dataclass fields to the exact keys the UI expects."""
        d = asdict(t)
        # Rename keys for the UI table
        return {
            "Transaction_ID": d["Transaction_ID"],
            "Date": d["Date"],
            "civic_tags": d["civic_tags"],
            "civic_score": d["civic_score"],
            "AI Category": d["AI_Category"],  # Added Space
            "AI Reasoning": d["AI_Reasoning"], # Added Space
            "is_civic": d["is_civic"]
        }

    def parse_and_shred(self, pdf_path: str, password: str = "") -> Dict[str, Any]:
        """
        Parse the PDF and then securely shred it.

        Returns a dictionary with status, transactions, and totals.
        """
        try:
            transactions = self.parse_pdf(pdf_path, password=password)
            total_taxable = sum(t.Amount for t in transactions if t.civic_tags == "TAXABLE")
            total_safe = sum(t.Amount for t in transactions if t.civic_tags == "SAFE")
            return {
                "status": "success",
                "transactions": transactions,
                "total_taxable_income": total_taxable,
                "total_safe_transfers": total_safe,
                "transaction_count": len(transactions)
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
        finally:
            # Secure deletion: overwrite and remove file
            if os.path.exists(pdf_path):
                try:
                    with open(pdf_path, "ba+") as f:
                        length = f.tell()
                        f.seek(0)
                        f.write(b"\x00" * length)
                    os.remove(pdf_path)
                    logger.info(f"Securely shredded {pdf_path}")
                except Exception as shred_err:
                    logger.error(f"Failed to shred file {pdf_path}: {shred_err}")