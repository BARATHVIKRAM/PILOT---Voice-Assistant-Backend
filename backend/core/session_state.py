"""
Per-session pipeline state — ring buffer, speaker context, TTS flag.
Persisted to SQLite on demand for reconnect support (Feature 2).
"""
from collections import deque
from dataclasses import dataclass, field
from typing import Optional
import json, logging, asyncio

logger = logging.getLogger("pilot.session_state")

@dataclass
class SessionPipelineState:
    session_id: str
    ring_buffer: deque = field(default_factory=lambda: deque(maxlen=50))
    current_speaker: Optional[str] = None
    current_role: Optional[str] = None
    barge_in: bool = False
    tts_playing: bool = False
    tts_start_time: float = 0.0
    active_tts_task: Optional[asyncio.Task] = None  # Tracks exactly when TTS playback started to prevent early microphone echo barge-ins
    usecase: str = "customercare"
    ambient_listening_active: bool = False # Gate ambient pipeline with a voice wake-word ('hey pilot' / 'stop')
    
    # Live manually typed context from frontend to override voice queries
    typed_origin: str = ""
    typed_destination: str = ""
    typed_date: str = ""

    # Live draft email state for real-time background sending
    pending_email_draft: str = ""
    pending_email_subject: str = ""
    pending_email_recipient_email: str = ""
    pending_email_recipient_name: str = ""

    def add_span(self, span: dict):
        self.ring_buffer.append(span)

    def get_context(self, n: int = 10) -> list[dict]:
        return list(self.ring_buffer)[-n:]

    def to_snapshot(self) -> str:
        return json.dumps({
            "ring_buffer": list(self.ring_buffer),
            "current_speaker": self.current_speaker,
            "current_role": self.current_role,
            "usecase": self.usecase,
            "ambient_listening_active": self.ambient_listening_active,
        })

    @classmethod
    def from_snapshot(cls, session_id: str, snapshot: str) -> "SessionPipelineState":
        data = json.loads(snapshot)
        s = cls(session_id=session_id)
        s.ring_buffer = deque(data.get("ring_buffer", []), maxlen=50)
        s.current_speaker = data.get("current_speaker")
        s.current_role = data.get("current_role")
        s.usecase = data.get("usecase", "customercare")
        s.ambient_listening_active = data.get("ambient_listening_active", False)
        return s


_states: dict[str, SessionPipelineState] = {}


def get_state(session_id: str) -> SessionPipelineState:
    if session_id not in _states:
        _states[session_id] = SessionPipelineState(session_id=session_id)
    return _states[session_id]


def clear_state(session_id: str):
    _states.pop(session_id, None)


async def persist_state(session_id: str):
    """Save ring buffer to SQLite so reconnects restore context."""
    state = _states.get(session_id)
    if not state:
        return
    try:
        from db.engine import AsyncSessionLocal
        from db.models import Session
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Session).where(Session.session_id == session_id))
            s = result.scalar_one_or_none()
            if s:
                s.snapshot = state.to_snapshot()
                await db.commit()
    except Exception as e:
        logger.error(f"persist_state error: {e}")


async def restore_state(session_id: str) -> bool:
    """Restore ring buffer from SQLite on WS reconnect."""
    try:
        from db.engine import AsyncSessionLocal
        from db.models import Session
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Session).where(Session.session_id == session_id))
            s = result.scalar_one_or_none()
            if s and s.snapshot:
                _states[session_id] = SessionPipelineState.from_snapshot(session_id, s.snapshot)
                logger.info(f"State restored for {session_id[:8]}")
                return True
    except Exception as e:
        logger.error(f"restore_state error: {e}")
    return False
