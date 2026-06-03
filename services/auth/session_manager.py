"""Session manager for storing M-Pesa passwords per phone number with TTL and test fallback."""
import os
import time
from dotenv import load_dotenv

# Load development environment if exists
if os.path.exists(".env.dev"):
    load_dotenv(".env.dev", override=True)

class SessionManager:
    """In-memory session manager for M-Pesa passwords with TTL and test fallback."""

    def __init__(self):
        # Dictionary mapping phone numbers to (password, timestamp) tuples
        self._sessions: dict[str, tuple[str, float]] = {}
        # TTL in seconds (20 minutes)
        self.ttl_seconds = 1200
        # Test numbers that should use static test code
        self.test_numbers = {"+254700000000", "+254711111111", "+254722222222"}
        # Static test code for development
        self.test_code = "192786"

    def get_password(self, phone_number: str) -> str | None:
        """Retrieve password for given phone number with TTL checking.

        Returns:
        - Static test code '192786' for test numbers
        - DEV_PASSWORD from .env.dev if in development mode and no cached password
        - Cached password if within TTL
        - None if no valid password available
        """
        # Test number fallback for frictionless local development
        if phone_number in self.test_numbers:
            return self.test_code

        # Check if we should use development password as fallback
        if os.getenv("DEV_PASSWORD"):
            # Check if we have a cached password that's still valid
            if phone_number in self._sessions:
                password, timestamp = self._sessions[phone_number]
                if time.time() - timestamp < self.ttl_seconds:
                    return password
            # Return dev password as fallback when no valid cached password
            return os.getenv("DEV_PASSWORD")

        # Check cached password with TTL validation
        if phone_number in self._sessions:
            password, timestamp = self._sessions[phone_number]
            if time.time() - timestamp < self.ttl_seconds:
                return password
            else:
                # Password expired, remove it
                del self._sessions[phone_number]

        return None

    def save_password(self, phone_number: str, password: str) -> None:
        """Store password for given phone number with current timestamp."""
        self._sessions[phone_number] = (password, time.time())

    def clear_expired_sessions(self) -> None:
        """Clear all expired sessions. Call periodically for cleanup."""
        current_time = time.time()
        expired_numbers = [
            phone for phone, (_, timestamp) in self._sessions.items()
            if current_time - timestamp >= self.ttl_seconds
        ]
        for phone in expired_numbers:
            del self._sessions[phone]

# Global instance
session_manager = SessionManager()