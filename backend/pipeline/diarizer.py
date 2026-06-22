import asyncio, logging
from queues.bus import QueueBus, TurnSegment, LabeledTurn

logger = logging.getLogger("pilot.diarizer")

class DiarizerWorker:
    def __init__(self, bus: QueueBus):
        self.bus = bus

    async def run(self):
        logger.info("Diarizer worker started")
        while True:
            seg: TurnSegment = await self.bus.diar_q.get()   # ← reads diar_q
            try:
                from services.diarizer import pyannote_provider
                segments = await pyannote_provider.segment(seg.pcm, session_id=seg.session_id)
                label = segments[0].speaker_label if segments else "spk-0"
            except Exception as e:
                logger.error(f"Diarizer error: {e}")
                label = "spk-0"

            labeled = LabeledTurn(
                pcm=seg.pcm, session_id=seg.session_id, timestamp=seg.timestamp,
                speaker_label=label, speaker_id=None, role=None, confidence=0.0
            )
            await self.bus.identity_q.put(labeled)   # ← writes identity_q
