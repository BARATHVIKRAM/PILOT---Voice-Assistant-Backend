"""WebSocket /ws/audio — receives raw PCM from browser."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from queues.bus import bus, RawAudioChunk
import time, logging

router = APIRouter()
logger = logging.getLogger("pilot.ws.audio")


@router.websocket("/ws/audio/{session_id}")
async def ws_audio(websocket: WebSocket, session_id: str):
    await websocket.accept()

    # Register session as LISTENING
    from core.session_manager import session_manager, SessionState
    from core.session_state import get_state
    if not session_manager.get(session_id):
        session_manager.register(session_id, 0, "unknown")
    await session_manager.transition(session_id, SessionState.LISTENING)
    logger.info(f"Audio WS connected: {session_id[:8]}")

    try:
        while True:
            data = await websocket.receive_bytes()
            chunk = RawAudioChunk(pcm=data, session_id=session_id, timestamp=time.time())
            
            # ── BARGE-IN / INTERRUPTION TRIGGER ──
            # When the user starts speaking while PILOT is outputting TTS,
            # trigger an instantaneous interruption event to cut the audio off immediately.
            # Adds a brief 600ms grace ignore window right after tts_start_time begins playing
            # to let the browser player start up and clear out residual mic/background noise frames.
            state = get_state(session_id)
            if state.tts_playing:
                grace_window = 0.600  # 600ms grace window
                if time.time() - state.tts_start_time > grace_window:
                    state.tts_playing = False
                    state.barge_in = True
                    logger.info(f"[{session_id[:6]}] Interruption detected! Emitting barge_in event to client.")
                    await bus.emit_event("barge_in", {}, session_id)
                else:
                    logger.debug(f"[{session_id[:6]}] Ignoring early mic frame during 600ms TTS startup grace window.")
                
            try:
                bus.raw_audio_q.put_nowait(chunk)
            except Exception:
                pass  # backpressure — drop
    except WebSocketDisconnect:
        await session_manager.transition(session_id, SessionState.ENDED)
        logger.info(f"Audio WS disconnected: {session_id[:8]}")
