"""
verify_judgment.py
Pulls 10 random transactions labeled 'Taxable/Business' and 10 labeled 'Safe/Personal'
and displays them in a table for verification.
"""
import json
import random
from tabulate import tabulate

def load_parsed_data(filepath):
    with open(filepath, 'r') as f:
        return json.load(f)

def classify_transaction(transaction):
    """Classify transaction based on Entity_Type and AI reasoning"""
    entity_type = transaction.get('Entity_Type', '')
    details = transaction.get('Details', '').lower()
    reasoning = transaction.get('AI Reasoning', '').lower()

    # Taxable/Business indicators
    tax_keywords = ['merchant', 'pay bill', 'paybill', 'till', 'business', 'taxable', 'revenue']
    tax_indicators = [kw for kw in tax_keywords if kw in details or kw in reasoning]

    # Safe/Personal indicators
    safe_keywords = ['p2p', 'personal', 'safe', 'received from', 'funds received', 'personal by default']
    safe_indicators = [kw for kw in safe_keywords if kw in details or kw in reasoning]

    if tax_indicators:
        return 'Taxable/Business'
    elif safe_indicators:
        return 'Safe/Personal'
    elif entity_type == 'Merchant':
        return 'Taxable/Business'
    elif entity_type == 'P2P':
        return 'Safe/Personal'
    else:
        return 'Unknown'

def build_table(transactions):
    table_data = []
    for txn in transactions:
        txn_id = txn.get('Transaction_ID', 'N/A')
        date = txn.get('Date', 'N/A')
        tags = txn.get('civic_tags', [])
        score = txn.get('civic_score', 'N/A')
        reason = txn.get('AI Reasoning', 'No reasoning provided')
        category = txn.get('AI Category', 'N/A')

        table_data.append([txn_id, date, tags, score, category, reason[:100]])

    return table_data

def main():
    parsed_file = 'data/parsed_transactions.json'

    try:
        transactions = load_parsed_data(parsed_file)
    except FileNotFoundError:
        print(f"ERROR: {parsed_file} not found. Run python3 services/pdf-engine/parser.py first.")
        return

    # Classify transactions
    classified = []
    for txn in transactions:
        txn['classification'] = classify_transaction(txn)
        classified.append(txn)

    # Separate into categories
    taxable = [t for t in classified if t['classification'] == 'Taxable/Business']
    safe = [t for t in classified if t['classification'] == 'Safe/Personal']

    # Sample 10 each
    random.seed(42)
    taxable_sample = random.sample(taxable, min(10, len(taxable)))
    safe_sample = random.sample(safe, min(10, min(len(safe), 10)))

    # Build table
    taxable_rows = build_table(taxable_sample)
    safe_rows = build_table(safe_sample)

    headers = ['Transaction_ID', 'Date', 'civic_tags', 'civic_score', 'AI Category', 'AI Reasoning']

    print("\n=== Taxable/Business Transactions (10 random samples) ===")
    print(tabulate(taxable_rows, headers=headers, tablefmt='psql'))

    print("\n=== Safe/Personal Transactions (10 random samples) ===")
    print(tabulate(safe_rows, headers=headers, tablefmt='psql'))

    print(f"\nTotal Taxable/Business: {len(taxable)}")
    print(f"Total Safe/Personal: {len(safe)}")

if __name__ == '__main__':
    main()
