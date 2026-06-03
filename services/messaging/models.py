
from enum import Enum
from pydantic import BaseModel
from typing import Optional


class UserState(str, Enum):
    UNBOARDED = "UNBOARDED"
    AWAITING_PDF = "AWAITING_PDF"
    PASSWORD_LOCKED = "PASSWORD_LOCKED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    LEARNING = "LEARNING"  # New state for transaction learning


class UserSession(BaseModel):
    phone_number: str
    state: UserState
    last_pdf_id: Optional[str] = None
