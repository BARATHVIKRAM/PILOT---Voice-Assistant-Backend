"""
slide_server.py — PILOT Slide Navigation WebSocket Bridge

Two roles:
  1. Serves the reveal.js HTML presentation at GET /
  2. Accepts WebSocket connections from the browser at /ws
  3. Accepts HTTP POST commands from BackgroundAgent at /slide/command

BackgroundAgent  →  POST /slide/command  →  slide_server  →  WebSocket  →  reveal.js browser
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

app = FastAPI()

# ─────────────────────────────────────────────────────────────
#  Connected browser clients
# ─────────────────────────────────────────────────────────────

connected_clients: Set[WebSocket] = set()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    print(f"[SlideServer] Browser connected. Total clients: {len(connected_clients)}")
    try:
        while True:
            # Keep connection alive, listen for any browser→server messages
            data = await websocket.receive_text()
            print(f"[SlideServer] Browser message: {data}")
    except WebSocketDisconnect:
        connected_clients.discard(websocket)
        print(f"[SlideServer] Browser disconnected. Total clients: {len(connected_clients)}")


# ─────────────────────────────────────────────────────────────
#  Command endpoint — called by BackgroundAgent
# ─────────────────────────────────────────────────────────────

@app.post("/slide/command")
async def slide_command(payload: dict):
    """
    Accepts commands from BackgroundAgent and broadcasts to all browser clients.

    Payload examples:
        {"action": "next"}
        {"action": "prev"}
        {"action": "goto", "index": 3}
        {"action": "first"}
        {"action": "last"}
    """
    action = payload.get("action", "next")
    print(f"[SlideServer] Received command: {payload}")

    if not connected_clients:
        return JSONResponse(
            {"status": "no_clients", "message": "No browser connected to slide server"},
            status_code=200
        )

    message = json.dumps(payload)
    disconnected = set()

    for client in connected_clients:
        try:
            await client.send_text(message)
        except Exception as e:
            print(f"[SlideServer] Failed to send to client: {e}")
            disconnected.add(client)

    connected_clients.difference_update(disconnected)

    return JSONResponse({
        "status": "ok",
        "action": action,
        "clients_notified": len(connected_clients)
    })


# ─────────────────────────────────────────────────────────────
#  Serve the reveal.js presentation
# ─────────────────────────────────────────────────────────────

@app.get("/")
async def serve_presentation():
    html_path = Path(os.getenv("PILOT_SLIDES_HTML", "slides.html"))
    if not html_path.exists():
        html_path = Path(os.path.join(os.path.dirname(__file__), "slides.html"))
    if html_path.exists():
        return HTMLResponse(html_path.read_text())
    return HTMLResponse("<h2>No slides loaded. Upload a .pptx and run ppt_to_reveal.py first.</h2>")


@app.get("/status")
async def status():
    return {"connected_clients": len(connected_clients)}


if __name__ == "__main__":
    port = int(os.getenv("PILOT_SLIDE_PORT", "8001"))
    print(f"[SlideServer] Starting on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")