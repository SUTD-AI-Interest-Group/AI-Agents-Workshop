"""Remote webhook: Sends a final result to the canvas platform with an HTTP POST.

If WEBHOOK_URL is empty, the tool keeps the card in ./outbox/<event_id>.json.
Thus, you can see the data that the tool sends.
"""
import json
import uuid

import requests
from crewai.tools import tool

from config import CREW_TOKEN, OUTBOX_DIR, TEAM_NAME, WEBHOOK_URL


@tool("publish_card")
def publish_card(title: str, content: str, sources: list[str]) -> str:
    """Put a final finding, with its evidence, as a card in the area of your team on the canvas.
    `title`: a short headline. `content`: 1 to 3 sentences (Markdown is OK). `sources`: URLs or file names."""
    card = {
        "event_id": f"{TEAM_NAME}-{uuid.uuid4().hex[:8]}",  # The server uses this ID to find duplicate requests
        "crew": TEAM_NAME,
        "title": title,
        "content": content,
        "sources": sources,
    }
    if not WEBHOOK_URL:
        OUTBOX_DIR.mkdir(exist_ok=True)
        (OUTBOX_DIR / f"{card['event_id']}.json").write_text(json.dumps(card, indent=2))
        return f"WEBHOOK_URL is empty. The card is in outbox/{card['event_id']}.json."
    try:
        r = requests.post(WEBHOOK_URL, json=card, timeout=15,
                          headers={"Authorization": f"Bearer {CREW_TOKEN}"})
        return f"Webhook reply {r.status_code}: {r.text[:300]}"
    except requests.RequestException as e:
        return f"Webhook request failed ({e}). The platform possibly did not get the card."
