"""
ASR Worker — faster-whisper.
Transitions session: LISTENING → PROCESSING → LISTENING
"""
import asyncio, logging, time, re
from queues.bus import QueueBus, LabeledTurn, TranscriptSpan

logger = logging.getLogger("pilot.asr")


class ASRWorker:
    def __init__(self, bus: QueueBus):
        self.bus = bus

    def _load(self):
        from services.stt import whisper_provider
        whisper_provider.load()

    async def run(self):
        await asyncio.to_thread(self._load)
        logger.info("ASR worker started")
        while True:
            turn: LabeledTurn = await self.bus.labeled_turn_q.get()
            try:
                await self._process(turn)
            except Exception as e:
                logger.error(f"ASR error: {e}", exc_info=True)

    async def _process(self, turn: LabeledTurn):
        from services.stt import whisper_provider
        from core.session_manager import session_manager, SessionState
        from core.session_state import get_state

        # → PROCESSING
        await session_manager.transition(turn.session_id, SessionState.PROCESSING)

        text = await whisper_provider.transcribe(turn.pcm)
        if not text.strip():
            await session_manager.transition(turn.session_id, SessionState.LISTENING)
            return

        # ── PRINT WHAT IS HEARD DIRECTLY TO TERMINAL ──
        print(f"\n🎙️ [PILOT LISTENS] Speaker: {turn.speaker_id or 'unknown'} | Text: \"{text}\"\n")

        # Clean punctuation from the whole string to make wake word matching robust (e.g. "Hey, Pilot" -> "hey pilot")
        normalized_text = re.sub(r"[^\w\s]", "", text.lower()).strip()
        state = get_state(turn.session_id)

        # ── WAKE WORD & SLEEP WORD HANDLING ──
        is_wake_word = any(w in normalized_text for w in ["hey pilot", "hello pilot", "hi pilot", "wake up pilot", "their pilot", "there pilot", "the pilot", "ok pilot", "okay pilot", "a pilot", "ey pilot", "ah pilot", "hey violet", "hello violet", "hi violet"])
        is_sleep_word = any(s in normalized_text for s in ["stop listening", "go to sleep", "sleep pilot", "mute pilot"])

        if is_sleep_word:
            state.ambient_listening_active = False
            logger.info(f"[{turn.session_id[:6]}] Sleep word received! Pinned state: ambient_listening_active=False")
            await self.bus.emit_event("transcript", {
                "text": "Go to sleep. Ambient listening is paused. Say 'Hey Pilot' to wake me up.",
                "speaker": "PILOT",
                "role": "assistant",
                "confidence": 1.0,
                "timestamp": time.time(),
            }, turn.session_id)
            await session_manager.transition(turn.session_id, SessionState.LISTENING)
            return

        if not state.ambient_listening_active:
            # Check if this is a direct slide control navigation command.
            # Slide navigation clicks should be allowed to bypass the ambient sleep state
            # for standard presentation slide-deck control convenience.
            is_slide_nav = any(cmd in normalized_text for cmd in ["next slide", "previous slide", "go back", "slide back", "last slide", "first slide", "jump to slide"])
            
            if is_wake_word or is_slide_nav:
                if is_wake_word:
                    state.ambient_listening_active = True
                    logger.info(f"[{turn.session_id[:6]}] Wake word matching verified! Pinned state: ambient_listening_active=True")
                    await self.bus.emit_event("transcript", {
                        "text": "Verified. I am online and listening for your commands.",
                        "speaker": "PILOT",
                        "role": "assistant",
                        "confidence": 1.0,
                        "timestamp": time.time(),
                    }, turn.session_id)
                    # Cut the trigger wake-phrase out so it doesn't execute accidental tasks
                    text = re.sub(r"\b(hey|hello|hi|wake up|their|there|the|ok|okay|a|ey|ah)\s+,?\s*(?:pilot|violet)\b", "", text, flags=re.IGNORECASE).strip()
                    if not text:
                        await session_manager.transition(turn.session_id, SessionState.LISTENING)
                        return
                else:
                    # Let it pass through silently for slide navigation control
                    logger.info(f"[{turn.session_id[:6]}] Bypassing ambient sleep gate for slide navigation control: '{text}'")
            else:
                # Gated state: Discard speech transcript silently
                logger.debug(f"[{turn.session_id[:6]}] Discarded transcript: '{text}' — Wake word required.")
                await session_manager.transition(turn.session_id, SessionState.LISTENING)
                return

        span = TranscriptSpan(
            text=text, session_id=turn.session_id,
            speaker_id=turn.speaker_id, role=turn.role,
            confidence=turn.confidence, timestamp=turn.timestamp,
        )

        # Update ring buffer
        get_state(turn.session_id).add_span({
            "speaker": turn.speaker_id, "role": turn.role,
            "text": text, "confidence": turn.confidence
        })

        # ── INTERCEPT FOR PENDING LATCH-WINDOW CONFIRMATIONS ──
        from tools.policy import PENDING_CONFIRMATIONS
        if turn.session_id in PENDING_CONFIRMATIONS:
            pending = PENDING_CONFIRMATIONS[turn.session_id]
            auth_speaker = pending["speaker_id"]
            
            # Verify if the speaker says "yes" or "confirm" or "approve"
            is_affirmative = any(word in normalized_text for word in ["yes", "confirm", "approve", "go ahead", "do it"])
            
            if is_affirmative:
                # Probabilistic voice match: check if speaking cluster matches the initiator
                if turn.speaker_id and turn.speaker_id.lower() == auth_speaker.lower():
                    logger.info(f"[policy] Latch window CONFIRMED! Speaker '{turn.speaker_id}' successfully authorized action '{pending['tool']}'.")
                    pending["confirmed"] = True
                    pending["event"].set()
                    
                    # Prevent forwarding "yes confirm" to LLM to avoid side-effects
                    await session_manager.transition(turn.session_id, SessionState.LISTENING)
                    return
                else:
                    logger.warning(f"[policy] Latch window Impersonation Blocked! Speaker '{turn.speaker_id}' attempted to confirm action '{pending['tool']}', but only '{auth_speaker}' is authorized.")
                    await self.bus.emit_event("tool_blocked", {
                        "tool": pending["tool"], "speaker": turn.speaker_id, "reason": "impersonation_detected"
                    }, turn.session_id)
                    # Force-close the confirmation as a failure
                    pending["confirmed"] = False
                    pending["event"].set()
                    await session_manager.transition(turn.session_id, SessionState.LISTENING)
                    return

        # Emit transcript to browser immediately
        await self.bus.emit_event("transcript", {
            "text": text,
            "speaker": turn.speaker_id or "You",
            "role": turn.role or "user",
            "confidence": round(turn.confidence, 3),
            "timestamp": turn.timestamp,
        }, turn.session_id)

        # Forward to front LLM
        await self.bus.transcript_q.put(span)

        # → back to LISTENING (front LLM may override to DELEGATING/SPEAKING)
        await session_manager.transition(turn.session_id, SessionState.LISTENING)
