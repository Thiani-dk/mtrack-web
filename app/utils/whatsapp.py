import httpx
import logging
from config import WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID

logger = logging.getLogger(__name__)

async def send_whatsapp_message(to_phone: str, text_body: str) -> bool:
    """
    Send a WhatsApp message via Meta's Graph API

    Args:
        to_phone: WhatsApp recipient phone number with country code (e.g., '1234567890')
        text_body: Message text to send

    Returns:
        bool: True if message sent successfully, False otherwise
    """
    url = f"https://graph.facebook.com/v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages"

    headers = {
        "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": text_body
        }
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)

            logger.info(f"WhatsApp API response status: {response.status_code}")
            logger.debug(f"WhatsApp API response body: {response.text}")

            if response.status_code == 200:
                return True
            else:
                logger.error(f"WhatsApp API error: {response.status_code} - {response.text}")
                return False

    except httpx.RequestError as e:
        logger.error(f"WhatsApp connection error: {str(e)}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error sending WhatsApp message: {str(e)}")
        return False