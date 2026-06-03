import os
import httpx
import logging

logger = logging.getLogger("mtrack.whatsapp_client")

async def send_whatsapp_text(to_phone: str, body: str):
    token = os.getenv("WHATSAPP_ACCESS_TOKEN")
    phone_id = os.getenv("PHONE_NUMBER_ID")
    if not token or not phone_id:
        logger.error("Missing WhatsApp credentials in environment configuration.")
        return

    url = f"https://graph.facebook.com/v25.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "text",
        "text": {"body": body}
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload, headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to send message: {response.text}")
        else:
            logger.info(f"Successfully dispatched outbound message to {to_phone}")