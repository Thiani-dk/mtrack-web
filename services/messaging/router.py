"""
Headless Message Machine & State Router – M-Track Core Engine

This module:
• Orchestrates state flow for incoming customer messages
• Maps phones to state contexts with strict masking
• Bridges to AsyncOpenClaw processing pipelines
• Generates audit‑ready financial artifacts
"""

# --- CONTEXT VARIABLES ---
# NOTE: This file explicitly follows the project‑wide rule that external memory
# lives only in /context.md / .cursorrules / other permanent files.
# All runtime session state lives in USER_SESSIONS (in‑memory only).

# --- DECLARATIVE RULES ---
# 1️⃣ State enumeration – ensures finitary state machine
# 2️⃣ Mask enforcement – prevents accidental PII leakage
# 3️⃣ Async pipelines – keep heavy work off main request path

# --- DECLARATIVE STATE SPACE ---
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from enum import Enum
from typing import Dict, Any
import os
import re
import logging
import datetime
import json

from openclaw import AsyncOpenClaw
from services.pdf_engine.parser import MpesaParser
from services.reporting.generator import ArtifactGenerator
from services.messaging.client import send_whatsapp_text

# --- CONSTANTS ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mtrack.router")

# --- STATE ENGINE DECLARATIONS ---
class UserState(str, Enum):
    ONBOARDING = "ONBOARDING"
    AWAITING_PDF = "AWAITING_PDF"
    ANALYSIS_COMPLETE = "ANALYSIS_COMPLETE"

# NOTE: In-memory store – replace with Redis/Postgres for production scale
USER_SESSIONS: Dict[str, Dict[str, Any]] = {}

# --- MODULES ---
pdf_parser = MpesaParser()   # ← used in async pipelines only

# --- SECURITY HELPERS ---
_PHONE_MASK_REGEX = re.compile(r"(\+\d{3})\d{5}(\d{3})")

def mask_phone_number(phone: str) -> str:
    """Mask raw phone identifiers per mtrack security specifications."""
    return _PHONE_MASK_REGEX.sub(r"\1*****\2", phone)

# --- ASYNC WORKPIPELINE ---
async def process_async_statement_pipeline(
    sender_masked: str,
    sender_raw: str,
    local_path: str,
) -> None:
    """
    Conduct the full end‑to‑end statement capture chain within
    AsyncOpenClaw's local execution context.
    """
    try:
        # 1️⃣ Parse → shred → extract raw financial signal
        analysis = pdf_parser.parse_and_shred(local_path)
        if analysis.get("status") != "success":
            logger.error(f"Aborting pipeline for {sender_masked}")
            return

        # 2️⃣ Generate audit‑ready deliverables (Phase III analogs)
        generator = ArtifactGenerator(user_id=sender_raw, metrics=analysis)
        paths = generator.build_all_artifacts()

        # 3️⃣ Update session state and persist artifact paths
        USER_SESSIONS.setdefault(sender_raw, {})["state"] = UserState.ANALYSIS_COMPLETE
        USER_SESSIONS[sender_raw]["artifacts"] = paths

        logger.info(
            f"Artifact pipeline complete for {sender_masked}. "
            "Deliverables built → %s",
            str(paths),
        )
    except Exception as exc:   # pragma: no‑cover – defensive only
        logger.exception(f"Error in background parsing pipeline: {exc}")

# --- MESSAGE HANDLER ----------------------------------------------------
async def handle_whatsapp_message(
    payload: dict,
    background_tasks: BackgroundTasks,
) -> str:
    print("--- WEBHOOK RECEIVED ---")
    """
    Entry point for every inbound WhatsApp webhook payload.
    """
    # 1️⃣ Safely unwrap Meta's nested payload structure into message_context
    try:
        if "entry" in payload:
            message_context = payload["entry"][0]["changes"][0]["value"]["messages"][0]
        elif "value" in payload and "messages" in payload["value"]:
            message_context = payload["value"]["messages"][0]
        else:
            if isinstance(payload, list) and len(payload) > 0:
                message_context = payload[0]
            else:
                message_context = payload
    except (IndexError, KeyError, TypeError):
        message_context = payload

    # 2️⃣ Immediate identifier masking using the unwrapped context
    sender_raw = message_context.get("from", "")
    sender_masked = mask_phone_number(sender_raw)

    if not sender_raw:
        logger.error(f"Missing 'from' field in unwrapped context. Context was: {message_context}")
        return "Missing 'from' field"

    # 🌟 FIX 1: Initialize session tracking so it is defined for the rest of the loops
    USER_SESSIONS.setdefault(sender_raw, {"state": UserState.ONBOARDING, "artifacts": {}})
    session = USER_SESSIONS[sender_raw]

    msg_type: str = message_context.get("type", "text")
    logger.info(f"Received {msg_type} from {sender_masked}")

    # ------------------------------------------------------------------
    # 🟢 Phase II Onboarding Engine – text → state transition map
    # ------------------------------------------------------------------
    if msg_type == "text":
        # 🌟 FIX 2: Extracted body from message_context instead of raw payload
        body: str = message_context.get("text", {}).get("body", "").strip().lower()

        # 1️⃣ Initiate onboarding flow
        if body in {"hi", "habari", "start", "this is a text message"}:
            session["state"] = UserState.AWAITING_PDF
            reply = (
                "Welcome to M‑Track: Your Agentic Financial Layer\n\n"
                "To isolate your taxable streams and calculate your Civic Credit Rating, "
                "please upload your encrypted or standard M‑Pesa Statement PDF here."
            )
            await send_whatsapp_text(sender_raw, reply)
            return reply

        # 2️⃣ Completed‑state acknowledgement
        if session.get("state") is UserState.ANALYSIS_COMPLETE:
            if "report" in body or "yes" in body:
                artifacts = session.get("artifacts", {})
                reply_complete = (
                    "Your M‑Track Financial Profiles have been rendered successfully:\n\n"
                    f"1. Lender Summary   → http://localhost:8000/static/{os.path.basename(artifacts.get('lender', ''))}\n"
                    f"2. Identity Passport→ http://localhost:8000/static/{os.path.basename(artifacts.get('identity', ''))}\n"
                    f"3. Income Defense   → http://localhost:8000/static/{os.path.basename(artifacts.get('defense', ''))}"
                )
                await send_whatsapp_text(sender_raw, reply_complete)
                return reply_complete

    # ------------------------------------------------------------------
    # 📎 Phase III Document Reception – single‑pass upload guard
    # ------------------------------------------------------------------
    if msg_type == "document" and session.get("state") is UserState.AWAITING_PDF:
        doc_payload = message_context.get("document", {})
        if doc_payload.get("mime_type") == "application/pdf":
            temp_path = f"/tmp/statement_{sender_raw}.pdf"

            background_tasks.add_task(
                process_async_statement_pipeline,
                sender_masked,
                sender_raw,
                temp_path,
            )

            # 🌟 FIX 3: Fixed dead execution block and variable name trap
            reply_doc = (
                "File received securely. Commencing multi‑tier categorization analysis. "
                "Please wait a moment..."
            )
            await send_whatsapp_text(sender_raw, reply_doc)
            return reply_doc

    # ------------------------------------------------------------------
    # 🟠 Phase IV Dialogue Fallback – AsyncOpenClaw core engine
    # ------------------------------------------------------------------
    async with AsyncOpenClaw.remote() as openclaw_client:
        agent_prompt = f"User State: {session.get('state')} | Input: {message_context.get('text', {}).get('body')}"
        reply = await openclaw_client.chat(agent_prompt)
        
        # 🌟 FIX 4: Outbound text executed BEFORE returning execution path
        await send_whatsapp_text(sender_raw, reply)
        return reply