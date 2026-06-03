from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import PlainTextResponse
from app.utils.whatsapp import send_whatsapp_message

app = FastAPI()

@app.get("/webhook")
async def verify_webhook(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode == "subscribe" and token == "dynabot":
        print("SUCCESS: Webhook verified securely by Meta.")
        return PlainTextResponse(content=challenge, status_code=200)

    raise HTTPException(status_code=403, detail="Verification failed")

@app.post("/webhook")
async def receive_webhook(request: Request):
    payload = await request.json()
    print("--- NEW WHATSAPP MESSAGE PAYLOAD ---")
    print(payload)
    print("------------------------------------")

    try:
        # Safely navigate the WhatsApp webhook payload structure
        entry = payload.get('entry', [{}])[0]
        changes = entry.get('changes', [{}])[0].get('value', {})
        messages = changes.get('messages', [])

        if messages:
            msg = messages[0]
            to_phone = msg.get('from')
            text_body = msg.get('text', {}).get('body')

            if to_phone and text_body and text_body.lower() in ['hi', 'hello']:
                welcome_text = "Welcome to M-Track! 🚀 Your Agentic Financial Layer is online. Please reply by pasting your raw M-Pesa statement text snippet or upload your statement to begin your credit summary profile analysis."
                await send_whatsapp_message(to_phone, welcome_text)
    except Exception as e:
        print(f"Error processing incoming message: {str(e)}")

    return {"status": "success"}