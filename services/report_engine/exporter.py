"""
Tax Compliance Exporter for QuickBooks integration
Generates CSV reports for business and taxable transactions
"""
import csv
import re
from pathlib import Path
from typing import List, Dict, Any
from services.pdf_engine.parser import Transaction


def mask_phone_number(details: str) -> str:
    """Mask phone numbers in Details column using ODPC-compliant regex"""
    phone_pattern = r'(\+?254|0)(7\d)\d{3}(\d{3})'
    return re.sub(phone_pattern, r'\1\2XXXX\3', details)


def generate_tax_csv(transactions: List[Transaction], output_path: str = "data/reports/tax_compliance.csv") -> str:
    """
    Generate QuickBooks-compatible CSV for tax compliance

    Args:
        transactions: List of Transaction objects
        output_path: Path to save CSV file

    Returns:
        Path to generated CSV file
    """
    # Filter transactions with civic_tags BUSINESS or TAX
    filtered_transactions = [
        txn for txn in transactions
        if txn.civic_tags in ['BUSINESS', 'TAX']
    ]

    if not filtered_transactions:
        print("⚠️ No BUSINESS or TAX transactions found")
        return output_path

    # Ensure reports directory exists
    report_dir = Path(output_path).parent
    report_dir.mkdir(parents=True, exist_ok=True)

    # Write CSV with proper formatting
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.writer(csvfile)

        # Write header
        writer.writerow(['Date', 'Transaction_ID', 'Details', 'Amount', 'Category'])

        # Write transactions
        for txn in filtered_transactions:
            masked_details = mask_phone_number(txn.Details)
            writer.writerow([
                txn.Date,
                txn.Transaction_ID,
                masked_details,
                txn.Amount,
                txn.civic_tags
            ])

    print(f"✅ Exported {len(filtered_transactions)} transactions to {output_path}")
    return output_path


def generate_tax_summary(transactions: List[Transaction]) -> Dict[str, Any]:
    """
    Generate summary statistics for tax compliance

    Args:
        transactions: List of Transaction objects

    Returns:
        Dictionary with summary statistics
    """
    business_txns = [t for t in transactions if t.civic_tags == 'BUSINESS']
    tax_txns = [t for t in transactions if t.civic_tags == 'TAX']

    return {
        'total_transactions': len(transactions),
        'business_count': len(business_txns),
        'tax_count': len(tax_txns),
        'business_total': sum(t.Amount for t in business_txns),
        'tax_total': sum(t.Amount for t in tax_txns),
        'masked_phone_count': len(re.findall(r'(\+?254|0)(7\d)\d{3}(\d{3})',
                                           ' '.join(t.Details for t in transactions)))
    }