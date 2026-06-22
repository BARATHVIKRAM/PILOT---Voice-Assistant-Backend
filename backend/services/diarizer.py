"""Diarizer provider interface — DS-B owns this."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
import logging
import numpy as np
from services.enrollment import embed_provider

logger = logging.getLogger("pilot.diarizer")


@dataclass
class DiarSegment:
    speaker_label: str   # spk-0, spk-1 ...
    start: float
    end: float


class DiarizeProvider(ABC):
    @abstractmethod
    async def segment(self, pcm: bytes, sample_rate: int = 16000, session_id: str = None) -> list[DiarSegment]: ...


# Global in-memory dictionary for sliding session centroids to track online speakers
_session_centroids: dict[str, list[tuple[str, np.ndarray]]] = {}


def _get_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


class PyannoteProvider(DiarizeProvider):
    """pyannote.audio fallback — DS-B wires real model here."""

    def __init__(self):
        self._pipeline = None

    def load(self):
        logger.info("Pyannote provider: active with unsupervised online speaker clustering")

    async def segment(self, pcm: bytes, sample_rate: int = 16000, session_id: str = None) -> list[DiarSegment]:
        duration = len(pcm) / (sample_rate * 2)
        if not session_id:
            return [DiarSegment(speaker_label="spk-0", start=0.0, end=duration)]

        # Extract voice embedding of the segment
        embedding = embed_provider.extract(pcm)
        
        if session_id not in _session_centroids:
            _session_centroids[session_id] = []
            
        centroids = _session_centroids[session_id]
        
        best_label = None
        best_score = -1.0
        
        for label, centroid in centroids:
            score = _get_similarity(embedding, centroid)
            if score > best_score:
                best_score = score
                best_label = label
                
        # Cosine similarity threshold of 0.72 for matching voice centroids
        if best_score >= 0.72:
            # Update centroid running mean smoothly to adapt to user position/inflection
            for idx, (label, centroid) in enumerate(centroids):
                if label == best_label:
                    updated = 0.8 * centroid + 0.2 * embedding
                    centroids[idx] = (label, updated / np.linalg.norm(updated))
                    break
        else:
            # Register a brand new unique voice cluster for this session context if under the 8-speaker threshold
            if len(centroids) < 8:
                best_label = f"spk-{len(centroids)}"
                centroids.append((best_label, embedding))
                logger.info(f"[diarizer] Registered new session speaker cluster '{best_label}' for session {session_id[:8]} (confidence={best_score:.3f})")
            else:
                # Max speaker threshold of 8 reached: map to the nearest available speaker cluster to prevent cluster overflow
                best_match_label, _ = max(centroids, key=lambda item: _get_similarity(embedding, item[1]))
                best_label = best_match_label
                logger.warning(f"[diarizer] Speaker threshold of 8 reached! Mapping segment to nearest cluster '{best_label}' instead of creating a new cluster.")
            
        return [DiarSegment(speaker_label=best_label, start=0.0, end=duration)]


class SortformerProvider(DiarizeProvider):
    """NVIDIA Streaming Sortformer — DS-B wires real model here."""

    async def segment(self, pcm: bytes, sample_rate: int = 16000, session_id: str = None) -> list[DiarSegment]:
        duration = len(pcm) / (sample_rate * 2)
        return [DiarSegment(speaker_label="spk-0", start=0.0, end=duration)]


pyannote_provider = PyannoteProvider()
sortformer_provider = SortformerProvider()
