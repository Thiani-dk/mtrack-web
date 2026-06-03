"""Categorizes transactions using ground truth rules from data/rules.json."""
import json
from pathlib import Path
from typing import List
from services.pdf_engine.parser import Transaction


def _load_rules() -> dict:
    """Load the transaction mapping rules from data/rules.json."""
    rules_path = Path(__file__).parent.parent.parent / "data" / "rules.json"
    if not rules_path.exists():
        return {"business_paybills": [], "personal_keywords": []}
    with open(rules_path) as f:
        return json.load(f)


def _save_rules(rules: dict) -> None:
    """Persist updated rules back to data/rules.json."""
    rules_path = Path(__file__).parent.parent.parent / "data" / "rules.json"
    with open(rules_path, "w") as f:
        json.dump(rules, f, indent=2)


def update_rules(description: str, user_choice: str) -> None:
    """Append a new rule to data/rules.json based on user classification.

    Args:
        description: Transaction description to add.
        user_choice: 'Business' or 'Personal'.
    """
    rules = _load_rules()
    if user_choice == "Business":
        rules["business_paybills"].append(description)
    elif user_choice == "Personal":
        rules["personal_keywords"].append(description)
    _save_rules(rules)


def categorize_transactions(transactions: List[Transaction]) -> List[Transaction]:
    """Assign civic_tag (BUSINESS, TAX, PERSONAL, UNKNOWN) to each transaction."""
    rules = _load_rules()
    paybills = set(rules.get("business_paybills", []))

    for txn in transactions:
        details_up = txn.Details.upper()

        for bill in paybills:
            if bill in details_up:
                txn.civic_tags = "BUSINESS"
                txn.AI_Category = "Business"
                txn.AI_Reasoning = f"Business transaction matching paybill {bill}."
                break

        if not txn.civic_tags:
            keywords = rules.get("personal_keywords", [])
            for kw in keywords:
                if kw.upper() in details_up:
                    txn.civic_tags = "PERSONAL"
                    txn.AI_Category = "Personal"
                    txn.AI_Reasoning = "Personal transaction."
                    break

        if not txn.civic_tags:
            txn.civic_tags = "UNKNOWN"
            txn.AI_Category = "Unknown"
            txn.AI_Reasoning = "Uncategorized transaction."

    return transactions