M-Track: Civic Financial Intelligence Platform
Mission
Disrupt predatory lending in Kenya by building a Civic Credit Score system that protects users from real-time surveillance and tax misuse through Income Defense logic. We position ourselves as the User's Lawyer in direct competition with the government's tax collection clerks.

Technical Architecture Reality
M-Track uses a hybrid execution pattern to maintain bulletproof reliability while operating under strict local resource limitations:

The Hard Part (Deterministic Backend): M-Pesa parsing and mathematical sorting are 100% deterministic. We extract highly irregular tables from raw text chunks or multi-page statement PDFs using Python utilities (pdfplumber / pikepdf) and process numbers strictly using Python's decimal.Decimal module to prevent float round-off errors.

The Easy Part (Conversational Orchestration): Clean structured JSON arrays are filtered by date bounds before being exposed to the LLM. OpenClaw handles contextual conversations, transactional deep-dives, and the conversational "vibe" of Nairobi talk flawlessly without wasting massive token context or local memory.

Core Features
Income Defense Technology: Protects users' PIN With No Obligation (PWO) status by systematically verifying and segregating informal or non-taxable cash flows (remittances, peer split-bills, loans, school fee support) inside a cryptographically timestamped vault before automated tracking flags it as commercial velocity.

The Professional Layer: A WhatsApp Reimbursement State Machine running headlessly via incoming Meta webhooks to process interactive statement-to-PDF pipelines.

Tax Butler: Real-time expense categorization and automated deep-dives that request user justifications for anomalies (e.g., nightlife spending at Milan Lounge) to anchor reports with eTIMS-ready compliance outputs.

Document Intelligence: Deep-dive analysis of M-Pesa or bank statement structures generating a formal KRA Income Defense PDF with complete transaction IDs, source node tracking, and legal arguments required to defend against audit gaps.

Technical Stack
AI Engine: Gemma 4 (Edge optimized / Local via Ollama & Unsloth), Gemini 3 Flash (Contextual Extraction), Claude 3.5 (Audit & Report Generation).

API Ingestion: FastAPI framework integrated with Meta Cloud API (WhatsApp webhook ingestion).

Database: PostgreSQL with active conversational state caching and Business_Accounts linking ShortCodes and MSISDNs.

Storage Policy: "Unlocked and Shredded" — encrypted statements are decrypted in-memory, evaluated, and immediately run through Python OS removal commands to comply with strict ODPC data minimization laws.

Ephemeral State & Data Structures
The data model architecture defines the core schemas for processing financial payloads without float round-off vulnerabilities. The M-Pesa Transaction profile tracks structural strings for unique transaction IDs, timestamped records, directional transaction categories (such as Inbound-Received, Paybill, Till, or Outbound), and precise currency values mapped strictly to Decimal formats alongside user balances and party parameters.

To maintain the active interactive loop, the application manages real-time session steps (such as awaiting incoming statements, active transaction selection, or adding custom compliance notes) alongside temporary tracking lists for relevant transaction records mapped to the user's active phone number identifier.

Production Environment Gotchas (.env)
To prevent Meta Cloud API 401 Unauthorized errors and invalid OAuth access token loops, the environment configurations must match exact string formats. The application setup requires a verification token string matching the platform webhook configuration, an active WhatsApp access token pulled freshly from the Meta Developer Dashboard, a target WhatsApp phone number identifier, and a direct PostgreSQL database connection string mapping host, user, password, and system tables.
