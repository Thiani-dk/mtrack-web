import os
import random
from decimal import Decimal
from tabulate import tabulate
from typing import List

# Import from our project modules
from services.pdf_engine.parser import MpesaParser, Transaction
from services.pdf_engine.categorizer import categorize_transactions

class ClassificationVerifier:
    def __init__(self, sample_file: str = "data/samples/test_statement.pdf"):
        self.sample_file = sample_file
        # Use the test password for verification
        self.dev_password = "192786"

    def load_sample(self) -> List[Transaction]:
        """Read and parse a sample transaction file dynamically.

        This will use the current MpesaParser implementation from services/pdf_engine/parser.py
        along with the latest classification rules from rules.json.
        """
        parser = MpesaParser()  # The parser instance automatically loads rules.json
        parsed = parser.parse_pdf(self.sample_file, password=self.dev_password)
        # Apply categorization (including heuristics and non-taxable fallback)
        return categorize_transactions(parsed)

    def run(self) -> None:
        """Main verification process displaying classification results.

        1. Loads a sample file
        2. Displays the first 5 transactions
        3. Shows a terminal table of 10 random inspected transactions
        """
        try:
            transactions = self.load_sample()[:5000]  # Limit to first 5k transactions
            if not transactions:
                print("No transactions found in sample file")
                return

            # Show first 5 transactions for quick validation
            if len(transactions) >= 5:
                print("First 5 Transactions:")
                for ix, t in enumerate(transactions[:5], 1):
                    print(f"{ix}. {t.Transaction_ID}: {t.Details} (KES {t.Amount:.2f})")

            # Randomly sample 10 unique transactions for detailed inspection
            inspection_sample = transactions
            if len(transactions) > 10:
                import random
                inspection_sample = random.sample(transactions, 10)
            else:
                inspection_sample = transactions[:10]  # All if less than 10

            # Generate output table
            headers = [
                "Transaction ID",
                "Details",
                "Amount",
                "Assigned Tag"
            ]
            rows = []
            for t in inspection_sample:
                rows.append([
                    t.Transaction_ID,
                    t.Details,
                    str(float(t.Amount)),  # Convert Decimal to float for display
                    t.civic_tags
                ])

            print(f"\nVibe Check Classification Results (Total Processed: {len(transactions)}):\n")
            print(tabulate(rows, headers=headers))

        except Exception as e:
            print(f"Verification failed: {e}")

if __name__ == "__main__":
    verifier = ClassificationVerifier()
    verifier.run()
