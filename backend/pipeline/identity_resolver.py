import asyncio, logging
from queues.bus import QueueBus, LabeledTurn

logger = logging.getLogger("pilot.identity")

class IdentityResolverWorker:
    def __init__(self, bus: QueueBus):
        self.bus = bus

    async def run(self):
        logger.info("IdentityResolver worker started")
        while True:
            turn: LabeledTurn = await self.bus.identity_q.get()   # ← reads identity_q
            try:
                from services.enrollment import identify_speaker
                speaker_id, role, confidence = await identify_speaker(turn.pcm)
                turn.speaker_id = speaker_id or "You"
                turn.role = role or "user"
                turn.confidence = confidence
            except Exception as e:
                logger.error(f"Identity error: {e}")
                turn.speaker_id = "You"
                turn.role = "user"
                turn.confidence = 0.8

            await self.bus.labeled_turn_q.put(turn)   # ← writes labeled_turn_q
