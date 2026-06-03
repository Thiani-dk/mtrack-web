# M-Track: Agentic Financial Layer (Source of Truth)

## 1. Project Mission
To disrupt predatory lending in Kenya by building a "Civic Credit Score" and protecting users from KRA over-taxation through "Income Defense" logic.

## 2. The 13-Day Sprint Roadmap (May 7 - May 20)
- **Phase I (Days 1-4): PDF Intelligence.**
- Engine: Python + Gemma 4 (Local) + Gemini 3 Flash.
- Logic: Parse 2-year M-Pesa statements. Classify "Safe" (Gifts/Loans) vs. "Taxable" (Revenue).
- **Phase II (Days 5-7): WhatsApp Headless Interface.**
- Tech: Meta Cloud API + OpenClaw orchestration.
- Goal: "Hi" -> Automated Onboarding Interview -> Statement Request.
- **Phase III (Days 8-10): Artifact Generation.**
- Tech: LaTeX/Puppeteer.
- Outputs:
  1. **Income Defense Report:** (Formal KRA defense + Layman TL;DR).
  2. **Lender’s Executive Summary:** (1-page Bank Dashboard).
  3. **Civic Identity Passport:** (Tax & Utility consistency record).
- **Phase IV (Days 11-13): Compliance Initiation.**
- Parallel Task: ODPC Data Controller filing, Daraja Production request, GavaConnect Sandbox registration.

## 3. Core Product Logic
### A. The "Income Defense" (Viral Hook)
- **Principle:** Inflow != Profit.
- **Detection:** Identify non-taxable flows: Remittances, Loans, Capital Transfers, and Reimbursements.
- **Goal:** Defend the user's "PIN With No Obligation" (PWO) status.

### B. The "Repo-Bot"
- **Trigger:** Webhook/Statement confirms income.
- **Action:** Prompt STK Push for outstanding loan recovery.
- **Fallback:** WhatsApp reminder with "Snooze/Schedule" capability.

### C. The "Tax Butler"
- **Function:** Real-time categorization of business vs. personal expenses via chat interview.
- **Output:** eTIMS-ready JSON drafts.

## 4. Tech Stack & Infrastructure
- **Agent Framework:** OpenClaw.
- **Messaging:** Meta Cloud API (WhatsApp).
- **Database:** PostgreSQL (with Business_Accounts table linking ShortCodes & MSISDNs).
- **AI Brain:** Gemini 3 Flash (Reasoning), Claude 3.5 (Deep Audit), Gemma 4 (Local Privacy).
- **Server:** DigitalOcean Droplet (~KES 1,500/mo).

## 5. Security & Trust
- **Verification:** Cryptographic proof of ownership via KES 1 STK Push or SMS OTP.
- **Transparency:** "Unlocked and Shredded" policy for all uploaded PDFs.
- **Integrity:** Immutable ledger for all Daraja-verified transactions.