import json
import os
from pathlib import Path
import importlib.util

def main():
    spec = importlib.util.spec_from_file_location("mpesa_parser", "services/pdf-engine/parser.py")
    mpesa_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mpesa_module)
    
    password = os.getenv("MPESA_PASSWORD", "")
    pdf_path = Path("data/samples/test_statement.pdf")
    
    print(f"--- M-Track Audit: {pdf_path.name} ---")
    parser = mpesa_module.MpesaParser()
    txns = parser.parse_pdf(str(pdf_path), password=password)
    
    if not txns:
        print("❌ No transactions found.")
        return

    output = Path("data/parsed_transactions.json")
    output.parent.mkdir(exist_ok=True)
    with open(output, "w") as f:
        # Use the to_ui_dict helper for perfect JSON keys
        json_data = [parser.to_ui_dict(t) for t in txns]
        json.dump(json_data, f, indent=2, default=str)
    
    print(f"✅ Success! Insight data ready for UI.")
    if Path("services/pdf-engine/verify_judgment.py").is_file():
        os.system("python3 services/pdf-engine/verify_judgment.py")

if __name__ == "__main__":
    main()
