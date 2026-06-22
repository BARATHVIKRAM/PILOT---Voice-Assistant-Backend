"""
Front LLM Worker — routes transcript → TTS + optional tool delegation.
Transitions: LISTENING → SPEAKING → LISTENING
              LISTENING → DELEGATING → LISTENING
"""
import asyncio, logging, base64, time
from dataclasses import dataclass
from typing import Optional
from queues.bus import QueueBus, TranscriptSpan

logger = logging.getLogger("pilot.front_llm")


@dataclass
class RouteDecision:
    action:     str
    preamble:   Optional[str]
    tool:       Optional[str]
    args:       dict
    mode:       str
    speaker_id: Optional[str]
    role:       Optional[str]
    session_id: str


class FrontLLMWorker:
    def __init__(self, bus: QueueBus):
        self.bus = bus

    def _load(self):
        from services.front_llm import front_llm_provider
        front_llm_provider.load()

    async def run(self):
        await asyncio.to_thread(self._load)
        logger.info("FrontLLM worker started")
        while True:
            span: TranscriptSpan = await self.bus.transcript_q.get()
            try:
                await self._process(span)
            except Exception as e:
                logger.error(f"FrontLLM error: {e}", exc_info=True)

    async def _process(self, span: TranscriptSpan):
        from services.front_llm import front_llm_provider
        from core.session_state import get_state
        from core.session_manager import session_manager, SessionState

        ctx = get_state(span.session_id).get_context(6)
        raw = await front_llm_provider.classify(
            text=span.text,
            speaker_id=span.speaker_id or "You",
            role=span.role or "user",
            context=ctx,
        )

        decision = RouteDecision(
            action=raw.get("action", "respond_now"),
            preamble=raw.get("preamble"),
            tool=raw.get("tool"),
            args=raw.get("args", {}),
            mode=raw.get("mode", "queue"),
            speaker_id=span.speaker_id,
            role=span.role,
            session_id=span.session_id,
        )

        logger.info(f"[{span.session_id[:6]}] {decision.action} "
                    f"preamble={decision.preamble!r} tool={decision.tool}")

        if decision.action == "ignore":
            return

        if decision.preamble:
            # → SPEAKING
            await session_manager.transition(span.session_id, SessionState.SPEAKING)
            # Show PILOT reply in transcript immediately
            await self.bus.emit_event("transcript", {
                "text":       decision.preamble,
                "speaker":    "PILOT",
                "role":       "assistant",
                "confidence": 1.0,
                "timestamp":  time.time(),
            }, span.session_id)
            
            # Cancel any existing active TTS task cleanly
            state = get_state(span.session_id)
            if state.active_tts_task and not state.active_tts_task.done():
                state.active_tts_task.cancel()
                logger.info(f"[{span.session_id[:6]}] Cancelled active TTS task to speak new content.")
                
            # Synthesise and send audio (async — doesn't block)
            task = asyncio.create_task(_speak(decision.preamble, span.session_id))
            state.active_tts_task = task

        if decision.action == "delegate" and decision.tool:
            # → DELEGATING
            await session_manager.transition(span.session_id, SessionState.DELEGATING)
            asyncio.create_task(_delegate(decision))


async def _speak(text: str, session_id: str):
    from services.tts import tts_to_bytes
    from queues.bus import bus
    from core.session_manager import session_manager, SessionState
    from core.session_state import get_state

    current_task = asyncio.current_task()
    logger.info(f"TTS synthesising: '{text}'")
    try:
        state = get_state(session_id)
        # Keep tts_playing False during compilation so late mic frames do not trigger accidental self-interruption
        state.tts_playing = False
        state.barge_in = False
        
        data, mime = await tts_to_bytes(text, speed=1.1)
        
        # Check if the user interrupted while TTS was compiling
        if state.barge_in:
            logger.info(f"[{session_id[:6]}] Interruption detected during TTS compilation. Aborting preamble playback.")
            return

        # If a newer TTS task was started, abort gracefully
        if state.active_tts_task is not current_task:
            logger.info(f"[{session_id[:6]}] New TTS task started during compilation. Aborting old preamble playback.")
            return

        if not data:
            logger.warning("TTS returned empty — no audio sent")
            return
            
        b64 = base64.b64encode(data).decode("ascii")
        # Set tts_playing to True right before emitting the audio to user's browser
        state.tts_playing = True
        state.tts_start_time = time.time()
        state.barge_in = False
        
        await bus.emit_event("tts_audio", {"b64": b64, "mime": mime}, session_id)
        logger.info(f"TTS sent {len(data)} bytes ({mime})")
        
        # Give the audio a moment to play out before clearing tts_playing
        # Calculated based on standard byte length / sample rate playback time (with a buffer)
        playback_duration = max(0.5, len(data) / 48000.0)
        await asyncio.sleep(playback_duration)
        
    except Exception as e:
        logger.error(f"TTS error: {e}", exc_info=True)
    finally:
        state = get_state(session_id)
        if state.active_tts_task is current_task:
            state.tts_playing = False
            state.active_tts_task = None
            await session_manager.transition(session_id, SessionState.LISTENING)


async def _delegate(decision: RouteDecision):
    from tools.policy import policy_gate
    from core.session_manager import session_manager, SessionState

    allowed = await policy_gate.check(
        tool=decision.tool, speaker_id=decision.speaker_id,
        role=decision.role, session_id=decision.session_id,
    )
    if not allowed:
        await session_manager.transition(decision.session_id, SessionState.LISTENING)
        return

    from core.bg_supervisor import bg_supervisor, Job
    import uuid
    job = Job(
        job_id=str(uuid.uuid4())[:8],
        tool=decision.tool, args=decision.args, mode=decision.mode,
        speaker_id=decision.speaker_id, role=decision.role,
        session_id=decision.session_id,
    )
    await bg_supervisor.submit(job)
    from queues.bus import bus
    await bus.emit_event("job_queued", {
        "job_id": job.job_id, "tool": job.tool,
        "requester": job.speaker_id, "mode": job.mode,
    }, job.session_id)
    # DELEGATING → LISTENING when job completes (bg_supervisor handles this)
