"""
Queue Bus — all asyncio.Queue singletons.
Pipeline: raw_audio_q → turn_q → diar_q → labeled_turn_q → transcript_q → event_q
"""
import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional
from core.config import settings


@dataclass
class RawAudioChunk:
    pcm: bytes
    session_id: str
    timestamp: float

@dataclass
class TurnSegment:
    pcm: bytes
    session_id: str
    timestamp: float
    duration_ms: float = 0.0

@dataclass
class LabeledTurn:
    pcm: bytes
    session_id: str
    timestamp: float
    speaker_label: str
    speaker_id: Optional[str]
    role: Optional[str]
    confidence: float

@dataclass
class TranscriptSpan:
    text: str
    session_id: str
    speaker_id: Optional[str]
    role: Optional[str]
    confidence: float
    timestamp: float

@dataclass
class PipelineEvent:
    type: str
    payload: Any
    session_id: str


class QueueBus:
    def __init__(self):
        self.raw_audio_q:    asyncio.Queue[RawAudioChunk]  = asyncio.Queue(maxsize=settings.RAW_AUDIO_Q_SIZE)
        self.turn_q:         asyncio.Queue[TurnSegment]    = asyncio.Queue(maxsize=settings.TURN_Q_SIZE)
        self.diar_q:         asyncio.Queue[TurnSegment]    = asyncio.Queue(maxsize=settings.TURN_Q_SIZE)   # NEW: SmartTurn → Diarizer
        self.labeled_turn_q: asyncio.Queue[LabeledTurn]   = asyncio.Queue(maxsize=settings.LABELED_TURN_Q_SIZE)
        self.identity_q:     asyncio.Queue[LabeledTurn]   = asyncio.Queue(maxsize=settings.LABELED_TURN_Q_SIZE)  # NEW: Diarizer → Identity
        self.transcript_q:   asyncio.Queue[TranscriptSpan] = asyncio.Queue(maxsize=settings.TRANSCRIPT_Q_SIZE)
        self.event_q:        asyncio.Queue[PipelineEvent]  = asyncio.Queue(maxsize=settings.EVENT_Q_SIZE)

    async def emit_event(self, event_type: str, payload: Any, session_id: str):
        evt = PipelineEvent(type=event_type, payload=payload, session_id=session_id)
        try:
            self.event_q.put_nowait(evt)
        except asyncio.QueueFull:
            pass

        if event_type == "transcript":
            asyncio.create_task(self._persist_transcript_async(session_id, payload))

    async def _persist_transcript_async(self, session_id: str, payload: Any):
        from db.engine import AsyncSessionLocal
        from db.models import TranscriptLog
        import logging
        try:
            async with AsyncSessionLocal() as db:
                db.add(TranscriptLog(
                    session_id=session_id,
                    speaker_id=payload.get("speaker") or payload.get("speaker_id"),
                    role=payload.get("role"),
                    text=payload.get("text", ""),
                    confidence=payload.get("confidence", 1.0),
                    timestamp=payload.get("timestamp") or 0.0,
                ))
                await db.commit()
        except Exception as e:
            logging.getLogger("pilot.bus").error(f"Async transcript persist failed: {e}")


bus = QueueBus()
