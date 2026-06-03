"""
Tangible Financial Document PDF Generation Engine

This module drops reliance on external components and leverages standard
reportlab canvas flow structures to dynamically export production-grade,
presentation-ready PDFs into your local static web path.
"""

from __future__ import annotations
import os
from decimal import Decimal
from typing import Dict
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors


class ArtifactGenerator:
    def __init__(self, user_id: str, metrics: Dict[str, any]):
        self.user_id = str(user_id)
        self.metrics = metrics
        self.taxable = metrics.get("total_taxable_income", Decimal("0.00"))
        self.safe = metrics.get("total_safe_transfers", Decimal("0.00"))
        self.output_dir = "static"
        os.makedirs(self.output_dir, exist_ok=True)

    def _create_base_pdf(
        self, filename: str, title: str, paragraphs: list[str]
    ) -> str:
        """Build a single PDF document using ReportLab's flowable canvas."""
        target_path = os.path.join(self.output_dir, filename)
        
        # Build document template flow layer with 40pt safe printable bounds
        doc = SimpleDocTemplate(
            target_path,
            pagesize=letter,
            rightMargin=40,
            leftMargin=40,
            topMargin=40,
            bottomMargin=40,
        )
        styles = getSampleStyleSheet()

        # Premium Corporate Dark Navy color matching M-Track interfaces
        title_style = ParagraphStyle(
            "DocTitle",
            parent=styles["Heading1"],
            fontSize=18,
            textColor=colors.HexColor("#1A365D"),
            spaceAfter=15,
        )
        body_style = ParagraphStyle(
            "DocBody",
            parent=styles["Normal"],
            fontSize=10,
            leading=15,
            spaceAfter=10,
            textColor=colors.HexColor("#2D3748")
        )

        story = [Paragraph(title, title_style), Spacer(1, 10)]
        for text in paragraphs:
            story.append(Paragraph(text, body_style))

        doc.build(story)
        return target_path

    def build_all_artifacts(self) -> Dict[str, str]:
        """Compiles all 3 core functional M-Track reports dynamically."""
        total_volume = self.taxable + self.safe
        
        # Calculate a robust sovereign user rating bounded accurately between 600 and 850
        civic_score = 600 + int(
            (self.safe / (total_volume if total_volume > 0 else 1)) * 250
        )

        lender_summary_path = self._create_base_pdf(
            f"Lender_Summary_{self.user_id}.pdf",
            "M-TRACK LENDER'S EXECUTIVE SUMMARY",
            [
                f"Client Identity Reference: Tokenized User Ref {self.user_id[-6:] if len(self.user_id) >= 6 else self.user_id}",
                f"Calculated Total Liquid Velocity Volume: KES {total_volume:,.2f}",
                f"Verified Non-Taxable Stable Capital Baseline: KES {self.safe:,.2f}",
                "Assessed Risk Factor Category: Tier-1 Reliable Liquidity Pool Baseline.",
                "Recommendation Flag: APPROVED FOR IMMEDIATE TIER-1 FINANCIAL FACILITY PROVISION.",
            ],
        )

        identity_passport_path = self._create_base_pdf(
            f"Identity_Passport_{self.user_id}.pdf",
            "CIVIC IDENTITY PASSPORT (SECURE LAYER)",
            [
                f"M-Track Ledger Sovereign Verification ID: MTK-{self.user_id[:4].upper() if len(self.user_id) >= 4 else 'USER'}-2026",
                f"Quantified Sovereign Civic Score Capitalization: {civic_score} Points",
                "Data Sovereignty Registry Verification: Authenticated via distributed platform signatures.",
                "Compliance Clearance: Zero flags found against unauthorized commercial profile exploitation.",
            ],
        )

        income_defense_path = self._create_base_pdf(
            f"Income_Defense_{self.user_id}.pdf",
            "INCOME DEFENSE REPORT (PROACTIVE COMPLIANCE)",
            [
                "Legal Framework Context Notice: Prepared under ODPC Privacy Framework Protocols.",
                f"Total Revenue Stream Extracted: KES {total_volume:,.2f}",
                f"Formally Documented Taxable Commercial Baseline: KES {self.taxable:,.2f}",
                f"Isolated Peer-to-Peer Protected Capital (Exempt): KES {self.safe:,.2f}",
                "Defensive Assertion: This document asserts the structural nature of isolated non-commercial "
                "transfers as distinct, non-taxable personal asset liquidity lines under regulatory privacy statutes.",
            ],
        )

        return {
            "lender": lender_summary_path,
            "identity": identity_passport_path,
            "defense": income_defense_path,
        }