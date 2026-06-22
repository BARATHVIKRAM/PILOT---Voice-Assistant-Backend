import asyncio, logging
from queues.bus import QueueBus, TurnSegment

logger = logging.getLogger("pilot.smart_turn")

import asyncio, logging, re
from queues.bus import QueueBus, TurnSegment
from services.stt import whisper_provider

logger = logging.getLogger("pilot.smart_turn")

# Trailing fragments indicating incomplete thoughts or natural breath pauses
INCOMPLETE_TRAILING = r"\b(and|but|or|if|because|so|then|with|to|the|for|like|um|ah|uh|on|at|by|my|our|your|we|i|they|he|she|who|which|that|what|when|how|is|are|was|were|be|been)$"

class SmartTurnWorker:
    def __init__(self, bus: QueueBus):
        self.bus = bus
        self._buffers: dict[str, list[bytes]] = {} # session_id -> list of buffered pcm chunks

    async def run(self):
        logger.info("SmartTurn worker started")
        while True:
            seg: TurnSegment = await self.bus.turn_q.get()
            try:
                await self._process(seg)
            except Exception as e:
                logger.error(f"SmartTurn error: {e}", exc_info=True)
                # Fallback: always forward to prevent blocking the audio pipeline
                await self.bus.diar_q.put(seg)

    async def _process(self, seg: TurnSegment):
        session_id = seg.session_id
        if session_id not in self._buffers:
            self._buffers[session_id] = []

        # Get raw transcription preview of the current segment
        text = await whisper_provider.transcribe(seg.pcm)
        t_clean = text.lower().strip(",.!? ")

        # Heuristics for semantic completeness
        is_filler_only = t_clean in ["um", "ah", "uh", "like", "so"]
        ends_with_conjunction = bool(re.search(INCOMPLETE_TRAILING, t_clean))
        is_extremely_short = len(t_clean.split()) < 3 and not any(cmd in t_clean for cmd in ["next", "prev", "first", "last", "slide", "stop", "confirm", "yes"])
        
        # Check if the combined accumulated duration exceeds 15 seconds (increased safety timeout / recognition size)
        current_buffer = self._buffers[session_id]
        total_buffered_bytes = sum(len(b) for b in current_buffer) + len(seg.pcm)
        total_duration_sec = total_buffered_bytes / (16000 * 2) # 16kHz mono 16-bit
        
        is_incomplete = (is_filler_only or ends_with_conjunction or is_extremely_short) and (total_duration_sec < 15.0)

        if is_incomplete and text.strip():
            logger.info(f"[{session_id[:6]}] Semantic VAD: Utterance '{text}' is incomplete. Buffering PCM to prevent cutoff.")
            self._buffers[session_id].append(seg.pcm)
        else:
            # Complete thought or hard duration cap reached
            if current_buffer:
                logger.info(f"[{session_id[:6]}] Semantic VAD: Thought completed. Prepending {len(current_buffer)} buffered segments.")
                current_buffer.append(seg.pcm)
                combined_pcm = b"".join(current_buffer)
                self._buffers[session_id] = []
                
                # Update segment with combined audio
                seg.pcm = combined_pcm
                seg.duration_ms = len(combined_pcm) / 32 # 32 bytes per ms
            
            # Forward to diarizer
            await self.bus.diar_q.put(seg)
