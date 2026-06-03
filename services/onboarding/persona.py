from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List


class PersonaPhase(str, Enum):
    CONCIERGE = "concierge"
    BUTLER = "butler"


@dataclass
class MenuItem:
    key: str
    title: str
    blurb: str


class MTrackPersona:
    """
    WhatsApp-facing persona: starts as a warm Concierge, then transitions into a practical Butler.
    """

    def __init__(self) -> None:
        self.phase: PersonaPhase = PersonaPhase.CONCIERGE

    def transition_to_butler(self) -> None:
        self.phase = PersonaPhase.BUTLER

    def first_contact_dialogue(self) -> str:
        menu = self.get_menu()
        menu_lines = "\n".join([f"{i+1}. {m.title} — {m.blurb}" for i, m in enumerate(menu)])
        return (
            "Sasa boss. Mimi ni M-Track — your Financial Lawyer. Kazi yangu ni ku-defend pesa yako "
            "na kuhakikisha inflow si lazima iwe taxable kama si revenue.\n\n"
            "Chagua huduma:\n"
            f"{menu_lines}\n\n"
            "M-Track: Tunaprotect jasho yako. 🇰🇪"
        )

    def get_menu(self) -> List[MenuItem]:
        return [
            MenuItem(
                key="income_defense",
                title="Income Defense",
                blurb="Tuna-separate Safe vs Taxable flows kwa statement yako, clean and defensible.",
            ),
            MenuItem(
                key="lender_summary",
                title="Lender Summary",
                blurb="One-page summary ya uwezo wako wa kulipa (no drama, just facts).",
            ),
            MenuItem(
                key="civic_identity",
                title="Civic Identity",
                blurb="Consistency record ya tax/utility signals — helps kwa approvals na audits.",
            ),
        ]

    def get_shredder_assurance(self) -> str:
        return (
            "Privacy Shield: 'Unlocked and Shredded'.\n"
            "- Statement inafunguliwa (decrypt) ndani ya RAM/temporary memory.\n"
            "- Hatuhifadhi PII yako kwa disk kama data ya kudumu.\n"
            "- Ikiwa tunahitaji temp file for decryption, tunai-delete immediately baada ya kusoma bytes.\n"
            "Goal: insights bila ku-leak maisha yako."
        )

    def get_statement_instructions(self) -> str:
        return (
            "60-second statement steps:\n"
            "\n"
            "Option A — M-Pesa App:\n"
            "1) Open M-Pesa App\n"
            "2) Go to Statements / M-Pesa Statements\n"
            "3) Choose date range (e.g., Jan 1–Dec 31)\n"
            "4) Export / Download PDF\n"
            "5) Send it here (or drop it where we request)\n"
            "\n"
            "Option B — *334#:\n"
            "1) Dial *334#\n"
            "2) Choose M-Pesa / My Account / Statements (wording varies)\n"
            "3) Request statement for the period\n"
            "4) Download the PDF when it arrives\n"
            "\n"
            "Tip: Use the full 2025 window so the audit is clean."
        )

    def butler_reconciliation_line(
        self,
        *,
        transaction_count: int,
        confidence_pct: int,
        high_value_ambiguities: int,
    ) -> str:
        """
        Butler-mode, post-audit status line (WhatsApp friendly).
        """
        return (
            f"I've reconciled {transaction_count:,} transactions. "
            f"My confidence is {confidence_pct}%, but I have {high_value_ambiguities} "
            f"'High-Value Ambiguities' I need to ask you about later."
        )

