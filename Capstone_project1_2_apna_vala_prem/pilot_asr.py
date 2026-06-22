

"""
PILOT — Streaming ASR Pipeline
Stack: faster-whisper (distil-large-v3) + Silero VAD + Smart Turn v3

Two-stage turn detection:
  Stage 1 — Silero VAD   : detects speech vs silence in 0.5s windows
  Stage 2 — Smart Turn v3: confirms the turn is linguistically complete
  Stage 3 — Whisper      : transcribes only confirmed complete utterances

Usage:
  python pilot_asr.py                          # live mic
  python pilot_asr.py --test                   # synthetic tests
  python pilot_asr.py --test --test-mic        # synthetic + live mic (5s)
  python pilot_asr.py --test --test-mic --seconds 10
"""

"""
PILOT — Streaming ASR Pipeline
Stack: faster-whisper (distil-large-v3) + Silero VAD + Smart Turn v3

Two-stage turn detection:
  Stage 1 — Silero VAD   : detects speech vs silence in 0.5s windows
  Stage 2 — Smart Turn v3: confirms the turn is linguistically complete
  Stage 3 — Whisper      : transcribes only confirmed complete utterances

Usage:
  python pilot_asr.py                          # live mic
  python pilot_asr.py --test                   # synthetic tests
  python pilot_asr.py --test --test-mic        # synthetic + live mic (5s)
  python pilot_asr.py --test --test-mic --seconds 10
"""

import asyncio
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.request

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions, get_speech_timestamps

# Import Front Agent and Background Agent
from FrontLLM.front_agent import call_classifier
from BackgroundLLM.background_agent import background_agent

# Smart Turn v3 — copy model.py + inference.py from:
# https://github.com/pipecat-ai/smart-turn
from inference import predict_endpoint


# ═════════════════════════════════════════════════════════════
#  AUDIO DSP — Noise floor gating + Gain normalisation
#
#  Applied per-chunk inside audio_callback BEFORE the sample
#  enters audio_queue, so every downstream stage (VAD, Smart
#  Turn, Whisper) always receives clean, normalised audio.
#
#  Pipeline per 1024-sample chunk:
#    raw mic → NoiseGate → GainNormaliser → audio_queue
# ═════════════════════════════════════════════════════════════
import threading

# ─────────────────────────────────────────────────────────────
#  TTS SPEAKING GATE
# ─────────────────────────────────────────────────────────────
tts_speaking = threading.Event()  # SET = TTS active, CLEAR = idle

INTERRUPT_WORDS = {"stop", "wait", "pause", "cancel", "hey pilot", "pilot", "interrupt", "be quiet"}

# ── Echo Cancellation History ──
recent_tts_texts = []

def add_recent_tts(text: str):
    global recent_tts_texts
    # Split text into sentences/clauses to make matching more precise
    parts = re.split(r"[.!?\n]+", text)
    for part in parts:
        norm = normalize_text(part)
        if norm and len(norm.split()) > 1: # track multi-word phrases, skip single words
            recent_tts_texts.append(norm)
    if len(recent_tts_texts) > 10:
        recent_tts_texts = recent_tts_texts[-10:]

def is_ai_echo(transcribed_text: str) -> bool:
    norm_transcribed = normalize_text(transcribed_text)
    if not norm_transcribed:
        return True

    transcribed_words = set(norm_transcribed.split())
    if not transcribed_words:
        return True

    for ai_text in recent_tts_texts:
        # Check direct substring matching
        if norm_transcribed in ai_text or ai_text in norm_transcribed:
            return True

        # Check word overlap percentage
        ai_words = set(ai_text.split())
        if ai_words:
            overlap = transcribed_words.intersection(ai_words)
            overlap_ratio = len(overlap) / len(transcribed_words)
            # If 65% or more of the transcribed words are found in the AI sentence, it's an echo!
            if overlap_ratio >= 0.65:
                return True

    return False


class NoiseGate:
    """
    Adaptive noise floor gate.

    Maintains a slow-moving RMS average of ambient noise.
    Chunks whose RMS falls below (noise_floor × gate_ratio)
    are zeroed out entirely — they never reach Silero VAD
    or Whisper, eliminating hiss/fan/hum hallucinations.

    Parameters
    ----------
    gate_ratio  — how many × above floor before gate opens
                  (2.0 = must be 2× louder than noise to pass)
    alpha_rise  — EMA speed when noise level rises  (slow)
    alpha_fall  — EMA speed when noise level falls  (fast)
    init_floor  — starting estimate before any audio seen
    """

    def __init__(
        self,
        gate_ratio: float = 2.0,
        alpha_rise: float = 0.01,
        alpha_fall: float = 0.10,
        init_floor: float = 0.002,
    ):
        self.gate_ratio  = gate_ratio
        self.alpha_rise  = alpha_rise
        self.alpha_fall  = alpha_fall
        self.noise_floor = init_floor

    def process(self, chunk: np.ndarray) -> np.ndarray:
        rms = float(np.sqrt(np.mean(chunk ** 2)))

        # Update noise floor estimate with asymmetric EMA:
        # rises slowly (conservative), falls quickly (responsive)
        if rms < self.noise_floor:
            self.noise_floor = (
                (1 - self.alpha_fall) * self.noise_floor
                + self.alpha_fall * rms
            )
        else:
            self.noise_floor = (
                (1 - self.alpha_rise) * self.noise_floor
                + self.alpha_rise * rms
            )

        # Gate: zero chunks that are pure background noise
        if rms < self.noise_floor * self.gate_ratio:
            return np.zeros_like(chunk)

        return chunk

    @property
    def floor_db(self) -> float:
        """Noise floor in dBFS — useful for debugging."""
        return 20.0 * np.log10(max(self.noise_floor, 1e-9))


class GainNormaliser:
    """
    Peak-tracking gain normaliser.

    Tracks a smoothed peak amplitude and scales every chunk
    so the loudest sample sits at `target_peak`. Keeps quiet
    and loud speakers at the same level going into Whisper,
    reducing recognition errors at both volume extremes.

    A hard clip at ±1.0 is applied as a safety net.

    Parameters
    ----------
    target_peak — desired peak amplitude after normalisation
    alpha       — EMA speed; lower = smoother but slower reaction
    min_peak    — floor on tracked peak (prevents ×∞ gain on silence)
    max_gain    — hard ceiling on gain multiplier
    """

    def __init__(
        self,
        target_peak: float = 0.9,
        alpha:       float = 0.05,
        min_peak:    float = 0.01,
        max_gain:    float = 20.0,
    ):
        self.target_peak  = target_peak
        self.alpha        = alpha
        self.min_peak     = min_peak
        self.max_gain     = max_gain
        self._smooth_peak = min_peak

    def process(self, chunk: np.ndarray) -> np.ndarray:
        chunk_peak = float(np.max(np.abs(chunk)))

        # EMA on peak (same alpha for rise and fall — keeps it simple)
        self._smooth_peak = max(
            (1 - self.alpha) * self._smooth_peak + self.alpha * chunk_peak,
            self.min_peak,
        )

        gain = min(self.target_peak / self._smooth_peak, self.max_gain)
        return np.clip(chunk * gain, -1.0, 1.0)

    @property
    def gain_db(self) -> float:
        """Current applied gain in dB."""
        gain = min(self.target_peak / self._smooth_peak, self.max_gain)
        return 20.0 * np.log10(max(gain, 1e-9))


class AudioDSP:
    """
    Combines NoiseGate → GainNormaliser into a single callable.

    Usage:
        dsp = AudioDSP()
        clean = dsp(raw_chunk)   # call on every chunk before queuing
        print(dsp.stats())       # "noise_floor=-42.1dBFS  gain=+6.3dB"
    """

    def __init__(self):
        self.gate       = NoiseGate()
        self.normaliser = GainNormaliser()

    def __call__(self, chunk: np.ndarray) -> np.ndarray:
        chunk = self.gate.process(chunk)
        chunk = self.normaliser.process(chunk)
        return chunk

    def stats(self) -> str:
        return (
            f"noise_floor={self.gate.floor_db:+.1f}dBFS  "
            f"gain={self.normaliser.gain_db:+.1f}dB"
        )


# Single shared DSP instance — lives for the process lifetime
_dsp = AudioDSP()


SAMPLE_RATE     = 16000          # Whisper + Smart Turn both require 16 kHz
VAD_WINDOW_SEC  = 1            # Silero runs on 0.5s windows
VAD_WINDOW      = int(SAMPLE_RATE * VAD_WINDOW_SEC)
MAX_TURN_SEC    = 8              # Smart Turn v3 max supported input
MAX_TURN_SAMPLES= SAMPLE_RATE * MAX_TURN_SEC
CHUNK_SIZE      = int(SAMPLE_RATE * 1.5)   # used in tests only

# Words Whisper commonly hallucinates on silence/noise.
HALLUCINATIONS = {
    "thank you",
    "thanks",
    "you",
    "oh",
    "no",
    "what",
    "you know",
    "hello",
    "hello hello",
    "hello hello hello",
    "hello hello hello hello",
    "bye",
    "video",
    ".",
}

SHORT_UTTERANCE_SECONDS = 0.8
SHORT_UTTERANCE_MAX_NO_SPEECH = 0.1
MAX_NO_SPEECH_PROB = 0.25
DIARIZER_BACKEND = os.getenv("PILOT_DIARIZER", "pyannote").lower()
PYANNOTE_MODEL = os.getenv("PYANNOTE_MODEL", "pyannote/speaker-diarization-3.1")
PYANNOTE_AUTH_TOKEN = os.getenv("PYANNOTE_AUTH_TOKEN") or os.getenv("HF_TOKEN")


class TurnDiarizer:
    """
    Optional turn-level diarization.

    pyannote is loaded lazily because it is a large optional dependency.
    Returned turns are relative to the current turn_buffer, matching Whisper's
    per-turn segment timestamps.
    """

    def __init__(self, backend: str = DIARIZER_BACKEND):
        self.backend = backend
        self.pipeline = None
        self.disabled_reason = None

    def _load_pyannote(self):
        if self.pipeline is not None or self.disabled_reason:
            return

        if not PYANNOTE_AUTH_TOKEN:
            self.disabled_reason = "missing PYANNOTE_AUTH_TOKEN or HF_TOKEN"
            print(f"[diarizer] disabled: {self.disabled_reason}")
            return

        try:
            from pyannote.audio import Pipeline
        except ImportError:
            self.disabled_reason = "pyannote.audio is not installed"
            print(f"[diarizer] disabled: {self.disabled_reason}")
            return

        try:
            self.pipeline = Pipeline.from_pretrained(
                PYANNOTE_MODEL,
                use_auth_token=PYANNOTE_AUTH_TOKEN,
            )
            print(f"[diarizer] pyannote loaded: {PYANNOTE_MODEL}")
        except Exception as exc:
            self.disabled_reason = str(exc)
            print(f"[diarizer] disabled: {exc}")

    def diarize(self, audio: np.ndarray) -> list[dict]:
        if self.backend in {"none", "off", "disabled"}:
            return []

        if self.backend != "pyannote":
            print(f"[diarizer] unsupported backend '{self.backend}', using unknown speakers")
            return []

        self._load_pyannote()
        if self.pipeline is None:
            return []

        try:
            import torch

            waveform = torch.from_numpy(audio.astype(np.float32)).unsqueeze(0)
            annotation = self.pipeline(
                {"waveform": waveform, "sample_rate": SAMPLE_RATE}
            )
        except Exception as exc:
            print(f"[diarizer] inference failed: {exc}")
            return []

        turns = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            turns.append({
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(speaker),
            })

        return turns


def speaker_for_span(start: float, end: float, diarization_turns: list[dict]) -> str:
    best_speaker = "unknown"
    best_overlap = 0.0

    for turn in diarization_turns:
        overlap = max(0.0, min(end, turn["end"]) - max(start, turn["start"]))
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = turn["speaker"]

    return best_speaker


diarizer = TurnDiarizer()


LLM_PROVIDER = os.getenv("PILOT_LLM_PROVIDER", "echo").lower()
LLM_MODEL = os.getenv("PILOT_LLM_MODEL", "llama3.2")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", LLM_MODEL)
TTS_SPEAK_URL = os.getenv("PILOT_TTS_SPEAK_URL", "http://127.0.0.1:8000/speak")
LLM_SYSTEM_PROMPT = os.getenv(
    "PILOT_SYSTEM_PROMPT",
    "You are PILOT, a concise voice assistant. Answer naturally in one or two sentences.",
)


def post_json(url: str, payload: dict, headers: dict | None = None, timeout: float = 60.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            **(headers or {}),
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def call_llm_sync(user_text: str, speaker: str = "unknown") -> str:
    
    if LLM_PROVIDER in {"echo", "mock", "none"}:
        return f"You said: {user_text}"

    if LLM_PROVIDER == "ollama":
        payload = {
            "model": LLM_MODEL,
            "stream": False,
            "messages": [
                {"role": "system", "content": LLM_SYSTEM_PROMPT},
                {"role": "user", "content": f"Speaker {speaker} said: {user_text}"},
            ],
        }
        try:
            result = post_json(OLLAMA_URL, payload, timeout=120.0)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Ollama request failed: {exc.code} {exc.reason} at {OLLAMA_URL}. "
                f"model={LLM_MODEL!r}. body={body[:300]!r}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Ollama is not reachable at {OLLAMA_URL}. Start it with `ollama serve`."
            ) from exc
        return result.get("message", {}).get("content", "").strip()

    if LLM_PROVIDER == "openai":
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is required when PILOT_LLM_PROVIDER=openai")

        payload = {
            "model": OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": LLM_SYSTEM_PROMPT},
                {"role": "user", "content": f"Speaker {speaker} said: {user_text}"},
            ],
        }
        result = post_json(
            f"{OPENAI_BASE_URL.rstrip('/')}/chat/completions",
            payload,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            timeout=120.0,
        )
        return result["choices"][0]["message"]["content"].strip()

    raise RuntimeError(f"Unsupported PILOT_LLM_PROVIDER={LLM_PROVIDER!r}")


async def call_llm(user_text: str, speaker: str = "unknown") -> str:
    return await asyncio.to_thread(call_llm_sync, user_text, speaker)


# def send_to_tts_sync(text: str) -> dict:
#     return post_json(TTS_SPEAK_URL, {"text": text}, timeout=30.0)
async def clear_tts_speaking_after_delay(delay: float) -> None:
    """Non-blocking async task to clear the speaking flag after playback completes."""
    await asyncio.sleep(delay)
    tts_speaking.clear()
    print("\n[ASR] 🎙️ Playback completed. Microphone listening reactivated.")

def send_to_tts_sync(text: str) -> dict:
    add_recent_tts(text)     # 📝 record in echo cancellation history
    tts_speaking.set()       # 🔇 gate ASR processing
    try:
        # Near-instantaneous post to initiate generation/streaming
        result = post_json(TTS_SPEAK_URL, {"text": text}, timeout=30.0)
        
        # Calculate duration of the spoken text dynamically from returned PCM bytes
        # 24000 Hz, 16-bit mono PCM = 2 bytes per sample = 48000 bytes per second
        total_bytes = result.get("bytes", 0)
        duration = total_bytes / 48000.0
        
        # Schedule the async clear on the running event loop without blocking the thread!
        # Add 1.2s of safety buffer for network latency/reverb
        delay = duration + 1.2
        print(f"[ASR] 🔇 Speech initiated ({duration:.2f}s). Protecting mic asynchronously for {delay:.2f}s...")
        
        if _loop and _loop.is_running():
            _loop.call_soon_threadsafe(
                lambda: _loop.create_task(clear_tts_speaking_after_delay(delay))
            )
        else:
            # Fallback if loop is not running yet
            tts_speaking.clear()
            
        return result
    except Exception as e:
        tts_speaking.clear()
        raise e


async def send_to_tts(text: str) -> dict:
    return await asyncio.to_thread(send_to_tts_sync, text)


# async def send_to_tts(text: str) -> dict:
#     return await asyncio.to_thread(send_to_tts_sync, text)
def stop_tts():
    """Attempt to cancel ongoing TTS playback."""
    tts_speaking.clear()
    try:
        # If your tts_server.py has a /stop endpoint, call it here
        post_json("http://127.0.0.1:8000/stop", {}, timeout=2.0)
    except Exception:
        pass  # best-effort — flag is already cleared

async def agent_loop(agent_queue: asyncio.Queue) -> None:
    """
    Consumes transcript_span events, runs Intent Classification on the user's
    text, and routes background tasks to the Background Agent, while replying
    to conversational queries directly.
    """
    while True:
        event = await agent_queue.get()

        if event.get("type") != "transcript_span":
            continue

        user_text = event.get("text", "").strip()
        if not user_text:
            continue

        speaker = event.get("speaker", "unknown")
        print(f"[agent] {speaker}: {user_text}")

        try:
            # 1. Run Intent Classification via FrontAgent
            print(f"[agent] Running intent classification for: '{user_text}'")
            classification = await call_classifier(user_text, speaker)
            intent = str(classification.get("intent", "CONVERSATION")).upper()
            task_type = str(classification.get("task_type", "None")).upper()
            response_text = classification.get("response", "")
            
            print(f"[agent] Classification result: intent={intent}, task_type={task_type}, response={response_text[:60]}...")

            # Smart routing: check if the intent or task_type indicates a background task
            is_background = (
                intent in ("BACKGROUND_TASK", "MCP_TOOL_QUERY", "SLIDE_CONTROL") or
                task_type not in ("NONE", "", "NULL")
            )

            if is_background:
                # Normalize task_type if the LLM misaligned the JSON fields
                if task_type == "NONE":
                    if intent == "MCP_TOOL_QUERY":
                        task_type = "MCP_TOOL_QUERY"
                    elif intent == "SLIDE_CONTROL":
                        task_type = "SLIDE_CONTROL"
                    else:
                        task_type = "COMPLEX_CALCULATION"
                
                task_details = classification.get("task_details", user_text)
                if not task_details:
                    task_details = user_text
                
                # 2. Submit the task to the Background Agent
                background_agent.submit_task(task_type, task_details)
            
            # 3. Speak the conversational reply or the background task acknowledgment
            if response_text:
                print(f"[PILOT] {response_text}")
                result = await send_to_tts(response_text)
                print(f"[agent] TTS result: {result}")
            else:
                print("[agent] Empty response from FrontAgent classification")

        except Exception as exc:
            print(f"[agent] Classification/routing error: {exc}")
            traceback_print = traceback.format_exc() if 'traceback' in globals() else ""
            print(traceback_print)
            continue


model = WhisperModel(
    "distil-large-v3",
    device="cpu",
    compute_type="int8",
    cpu_threads=8,       # set to: sysctl -n hw.logicalcpu
)



WAKE_WORDS = {
    "hey pilot",
    "pilot",
    "okay pilot",
    "hello pilot",
    "wake_up"
}

def contains_wake_word(text: str) -> bool:
    text = text.lower().strip()

    return any(
        wake in text
        for wake in WAKE_WORDS
    )

SLEEP_WORDS = {
    "stop listening",
    "goodbye",
    "go to sleep",
    "sleep now",
    "exit"
}

def contains_stop_word(text: str) -> bool:
    text = text.lower().strip()

    return any(
        phrase in text
        for phrase in SLEEP_WORDS
    )


assistant_awake = False

def normalize_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    return " ".join(text.split())


def is_probable_hallucination(text: str, seg) -> bool:
    normalized = normalize_text(text)

    if not normalized:
        return True

    if normalized in HALLUCINATIONS:
        return True

    duration = max(0.0, float(seg.end) - float(seg.start))
    is_short = duration < SHORT_UTTERANCE_SECONDS and len(normalized.split()) <= 2
    is_command = contains_wake_word(normalized) or contains_stop_word(normalized)

    if is_short and not is_command and seg.no_speech_prob > SHORT_UTTERANCE_MAX_NO_SPEECH:
        return True

    return False




async def process_user_text(
    text: str,
    seg,
    agent_queue: asyncio.Queue = None,
    speaker: str = "unknown",
    diarization_turns: list[dict] | None = None,
):
    """
    Handles:
      - Wake word detection
      - Sleep word detection
      - Transcript span routing
      - Word-level transcript events
    """

    global assistant_awake

    text = text.strip()

    if not text:
        return False

    text_lower = text.lower()

    # =========================================================
    # ASSISTANT SLEEPING
    # =========================================================

    if not assistant_awake:

        for wake_word in WAKE_WORDS:
            normalized_text=normalize_text(text)
            normalized_wake = normalize_text(wake_word)

            if normalized_text == normalized_wake or normalized_text.startswith(f"{normalized_wake} "):

                assistant_awake = True

                print("\n🚀 WAKE WORD DETECTED")
                print("🤖 Pilot is now listening")

                # Remove wake word from the normalized phrase. This avoids
                # routing punctuation-only leftovers like "Pilot." -> ".".
                remaining_text = normalized_text.removeprefix(normalized_wake).strip()

                # Example:
                # "hey pilot what is weather"
                # -> "what is weather"

                if remaining_text and not is_probable_hallucination(remaining_text, seg) and agent_queue:

                    event = {
                        "type": "transcript_span",
                        "speaker": speaker,
                        "start": seg.start,
                        "end": seg.end,
                        "text": remaining_text,
                        "confidence": 1.0 - seg.no_speech_prob,
                    }

                    await agent_queue.put(event)

                    print(f"➡️ Routed: {remaining_text}")

                return False

        print("😴 Waiting for wake word...")
        return False

    # =========================================================
    # ASSISTANT AWAKE
    # =========================================================

    for sleep_word in SLEEP_WORDS:
        normalized_text = normalize_text(text)


        if normalized_text == normalize_text(sleep_word):

            assistant_awake = False

            print("\n😴 SLEEP WORD DETECTED")
            print("🤖 Pilot is now sleeping")

            return False

    # =========================================================
    # SEGMENT-LEVEL TRANSCRIPT EVENT
    # =========================================================

    if agent_queue:

        segment_event = {
            "type": "transcript_span",
            "speaker": speaker,
            "start": seg.start,
            "end": seg.end,
            "text": text,
            "confidence": 1.0 - seg.no_speech_prob,
        }

        await agent_queue.put(segment_event)

    print(f"Routing: {text}")

    # =========================================================
    # WORD-LEVEL EVENTS
    # =========================================================

    if seg.words:

        for word in seg.words:

            word_text = word.word.strip()

            if not word_text:
                continue

            word_speaker = speaker_for_span(
                float(word.start),
                float(word.end),
                diarization_turns or [],
            ) or speaker
            if word_speaker == "unknown":
                word_speaker = speaker

            word_event = {
                "type": "word_span",
                "speaker": word_speaker,
                "start": word.start,
                "end": word.end,
                "text": word_text,
            }

            if agent_queue:
                await agent_queue.put(word_event)

    return True
# ─────────────────────────────────────────────────────────────
#  SHARED STATE
# ─────────────────────────────────────────────────────────────

audio_queue: asyncio.Queue = asyncio.Queue()
_loop: asyncio.AbstractEventLoop = None


# ─────────────────────────────────────────────────────────────
#  AUDIO CALLBACK  (sounddevice thread → asyncio queue)
# ─────────────────────────────────────────────────────────────

def audio_callback(indata, frames, time_info, status):
    if status:
        print(f"[audio] {status}")
    # DSP: noise gate + gain normalisation before queuing
    raw   = indata[:, 0].copy()
    clean = _dsp(raw)
    _loop.call_soon_threadsafe(audio_queue.put_nowait, clean)


# ─────────────────────────────────────────────────────────────
#  STAGE 1 — Silero VAD
# ─────────────────────────────────────────────────────────────

def is_speech(audio: np.ndarray, threshold: float = 0.75) -> bool:
    """Returns True if Silero detects speech energy in this window."""
    opts = VadOptions(
        min_silence_duration_ms=300,
        speech_pad_ms=100,
        threshold=threshold,
    )
    timestamps = get_speech_timestamps(audio, opts)
    return len(timestamps) > 0


# ─────────────────────────────────────────────────────────────
#  STAGE 2 — Smart Turn v3
# ─────────────────────────────────────────────────────────────

def is_turn_complete(turn_audio: np.ndarray, threshold: float = 0.6) -> bool:
    """
    Asks Smart Turn v3 whether the speaker has finished their thought.
    Returns True only when both:
      - model predicts endpoint=True
      - confidence probability >= threshold

    Unlike VAD (energy), Smart Turn uses prosody + linguistic cues:
      "I was going to, um..."  → False  (mid-sentence pause)
      "See you tomorrow."      → True   (complete thought)
    """
    result = predict_endpoint(turn_audio)
    print(result)
    prob   = result["probability"]
    done   = result["prediction"]
    print(f"  [smart-turn] endpoint={done}  prob={prob:.2f}")
    return done and prob >= threshold




async def transcribe_and_route(
    audio: np.ndarray,
    agent_queue: asyncio.Queue = None,
):
    diarization_turns = await asyncio.to_thread(diarizer.diarize, audio)
    if diarization_turns:
        labels = sorted({turn["speaker"] for turn in diarization_turns})
        print(f"[diarizer] speakers: {', '.join(labels)}")

    segs, _ = model.transcribe(
        audio,
        language="en",
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=100,
            threshold=0.7,
        ),
        word_timestamps=True,
        condition_on_previous_text=False,
    )

    for seg in segs:
        text = seg.text.strip()

        if not text:
            continue
        if is_probable_hallucination(text, seg):
            continue
        if seg.no_speech_prob > MAX_NO_SPEECH_PROB:
            continue

        # ── Echo Cancellation and Interruption Gate ──────────
        normalized = normalize_text(text)
        
        # We only apply echo suppression if the AI is actively speaking (to avoid false-positive human suppression when quiet)
        if tts_speaking.is_set():
            if is_ai_echo(text):
                print(f"[ASR] 🔇 Suppressed echo of AI voice: '{text}'")
                continue   # skip further processing / routing as it's the AI's own voice
            else:
                # Playback is active, but the mic captured speech that does NOT match what the AI is saying.
                # This means a human has spoken/interrupted. We stop the AI and process the human's command!
                print(f"[ASR] 🛑 Human voice detected during playback: '{text}' — interrupting AI")
                tts_speaking.clear()
                stop_tts()
        # ─────────────────────────────────────────────────────

        speaker = speaker_for_span(float(seg.start), float(seg.end), diarization_turns)
        print(f"\n[{speaker}] {text}")

        if seg.words:
            words = " | ".join(
                f"{w.word.strip()}@{w.start:.2f}s" for w in seg.words
            )
            print(f"    {words}")

        await process_user_text(
            text=text,
            seg=seg,
            agent_queue=agent_queue,
            speaker=speaker,
            diarization_turns=diarization_turns,
        )

# # ─────────────────────────────────────────────────────────────
#  MAIN PIPELINE LOOP
# ─────────────────────────────────────────────────────────────

async def transcribe(agent_queue: asyncio.Queue = None) -> None:
    """
    Continuously reads mic audio from audio_queue.

    Flow:
      audio_callback → audio_queue (1024 raw samples each)
        → accumulated into 0.5s windows for Silero VAD
        → speech windows added to turn_buffer
        → on silence: Smart Turn checks if turn is complete
        → if complete: flush turn_buffer to Whisper
    """
    turn_buffer  = np.array([], dtype=np.float32)  # grows with speech
    chunk_buffer = np.array([], dtype=np.float32)  # sub-window accumulator
    in_speech    = False

    while True:
        # Accumulate raw 1024-sample callbacks into 0.5s VAD windows
        raw = await audio_queue.get()
        chunk_buffer = np.concatenate([chunk_buffer, raw])

        if len(chunk_buffer) < VAD_WINDOW:
            continue                                # not enough yet

        window       = chunk_buffer[:VAD_WINDOW]
        chunk_buffer = chunk_buffer[VAD_WINDOW:]   # keep remainder

        speech_now = is_speech(window)

        if speech_now:
            # ── speaking ─────────────────────────────────────
            in_speech   = True
            turn_buffer = np.concatenate([turn_buffer, window])

            # Cap at 8s so Smart Turn model never overflows
            if len(turn_buffer) > MAX_TURN_SAMPLES:
                turn_buffer = turn_buffer[-MAX_TURN_SAMPLES:]

        elif in_speech and len(turn_buffer) > 0:
            # ── silence after speech → ask Smart Turn ────────
            if is_turn_complete(turn_buffer):
                print("\n[PILOT] Turn complete — flushing to Whisper")
                await transcribe_and_route(turn_buffer.copy(), agent_queue)
                # Reset for next turn
                turn_buffer = np.array([], dtype=np.float32)
                in_speech   = False
            else:
                # Filler pause ("um", breath) — keep accumulating
                print("[PILOT]  Mid-sentence pause — continuing...")
                turn_buffer = np.concatenate([turn_buffer, window])


# ─────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────

async def main() -> None:
    global _loop
    _loop     = asyncio.get_event_loop()
    agent_q   = asyncio.Queue()
    
    # Register the TTS callback to protect the mic during background agent replies
    from BackgroundLLM.background_agent import register_send_to_tts_callback
    register_send_to_tts_callback(send_to_tts_sync)
    
    # Start the background agent loop
    background_agent.start()
    
    agent_task = asyncio.create_task(agent_loop(agent_q))

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            callback=audio_callback,
            dtype="float32",
            blocksize=1024,
        ):
            print(" PILOT listening (Silero VAD + Smart Turn v3 active)...")
            print(f"    LLM provider={LLM_PROVIDER}  TTS={TTS_SPEAK_URL}")
            print("    Speak wake word first, then a complete sentence.\n")
            await transcribe(agent_q)
    finally:
        agent_task.cancel()
        background_agent.stop()
        try:
            await agent_task
        except asyncio.CancelledError:
            pass


# ══════════════════════════════════════════════════════════════
#  TESTS
# ══════════════════════════════════════════════════════════════

async def _test_audio_callback():
    """Callback must deliver a 1-D float32 array of exactly 1024 samples."""
    global _loop
    _loop = asyncio.get_event_loop()

    fake = np.random.rand(1024, 1).astype(np.float32)
    audio_callback(fake, 1024, {}, None)
    result = await asyncio.wait_for(audio_queue.get(), timeout=1.0)

    assert result.ndim == 1,           f"Expected 1-D, got {result.ndim}-D"
    assert result.shape[0] == 1024,    f"Expected 1024 samples"
    assert result.dtype == np.float32, f"Expected float32"
    print("_test_audio_callback passed")


async def _test_buffer_accumulate():
    """Buffer must grow and slice at CHUNK_SIZE without memory leak."""
    global _loop
    _loop = asyncio.get_event_loop()

    small  = 1024
    needed = (CHUNK_SIZE // small) + 2
    for _ in range(needed):
        audio_queue.put_nowait(np.random.rand(small).astype(np.float32))

    buffer    = np.array([], dtype=np.float32)
    processed = 0
    while not audio_queue.empty():
        chunk  = audio_queue.get_nowait()
        buffer = np.concatenate([buffer, chunk])
        if len(buffer) >= CHUNK_SIZE:
            buffer = buffer[CHUNK_SIZE:]
            processed += 1

    assert processed >= 1,           f"Expected ≥1 chunk processed, got {processed}"
    assert len(buffer) < CHUNK_SIZE, f"Leftover {len(buffer)} ≥ CHUNK_SIZE"
    print(f"_test_buffer_accumulate passed  ({processed} chunk(s) processed)")


async def _test_is_speech_silent():
    """Silero VAD must return False on a zero-filled array."""
    silent = np.zeros(VAD_WINDOW, dtype=np.float32)
    result = is_speech(silent)
    assert result is False, "Expected no speech on silence"
    print("_test_is_speech_silent passed")


async def _test_transcribe_silent():
    """Whisper VAD must return no segments on silent audio."""
    silent = np.zeros(CHUNK_SIZE, dtype=np.float32)
    segs, _ = model.transcribe(
        silent,
        language="en",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300, speech_pad_ms=200, threshold=0.5),
        condition_on_previous_text=False,
    )
    texts = [s.text for s in segs]
    assert texts == [] or all(t.strip() == "" for t in texts), \
        f"Expected no speech, got: {texts}"
    print(" _test_transcribe_silent passed")


async def _test_transcribe_sine():
    """Sine tone must not crash; VAD should suppress it."""
    t    = np.linspace(0, 1.5, CHUNK_SIZE, dtype=np.float32)
    sine = 0.3 * np.sin(2 * np.pi * 400 * t)
    segs, _ = model.transcribe(
        sine, language="en", vad_filter=True, condition_on_previous_text=False
    )
    texts = [s.text.strip() for s in segs if s.text.strip()]
    label = texts if texts else "none — VAD suppressed"
    print(f"  _test_transcribe_sine passed  (output: {label})")


async def _test_transcribe_and_route_silent():
    """Silent audio must not push anything to agent_queue."""
    agent_q = asyncio.Queue()
    await transcribe_and_route(np.zeros(CHUNK_SIZE, dtype=np.float32), agent_q)
    assert agent_q.empty(), "Silent audio must not route to agent_queue"
    print("_test_transcribe_and_route_silent passed")


async def _test_route_schema():
    """If noise routes anything, the dict schema must be correct."""
    agent_q = asyncio.Queue()
    noise   = np.random.rand(CHUNK_SIZE).astype(np.float32) * 0.1
    await transcribe_and_route(noise, agent_q)
    if not agent_q.empty():
        item = agent_q.get_nowait()
        assert item["type"] == "user_utterance", f"Bad type: {item['type']}"
        assert isinstance(item["text"], str),    f"Bad text type"
        print(f"_test_route_schema passed  (routed: '{item['text']}')")
    else:
        print("_test_route_schema passed  (VAD suppressed noise)")


async def _test_speaker_for_span():
    turns = [
        {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"},
        {"start": 1.0, "end": 2.5, "speaker": "SPEAKER_01"},
    ]

    assert speaker_for_span(0.2, 0.8, turns) == "SPEAKER_00"
    assert speaker_for_span(1.2, 2.0, turns) == "SPEAKER_01"
    assert speaker_for_span(3.0, 3.5, turns) == "unknown"
    print("✅  _test_speaker_for_span passed")


async def _test_mic_live(duration_seconds: int = 5):
    """
    Opens real mic for `duration_seconds`.
    Assert: ≥1 non-empty segment transcribed.
    Speak clearly when you see 'Recording...'
    """
    global _loop
    _loop = asyncio.get_event_loop()

    # Drain stale queue items from previous tests
    while not audio_queue.empty():
        audio_queue.get_nowait()

    received = []

    async def _capture():
        buf = np.array([], dtype=np.float32)
        while True:
            chunk = await audio_queue.get()
            buf   = np.concatenate([buf, chunk])
            if len(buf) >= CHUNK_SIZE:
                audio_data = buf[:CHUNK_SIZE]
                buf        = buf[CHUNK_SIZE:]
                segs, _    = model.transcribe(
                    audio_data,
                    language="en",
                    beam_size=5,
                    vad_filter=True,
                    vad_parameters=dict(
                        min_silence_duration_ms=300,
                        speech_pad_ms=100,
                        threshold=0.6,
                    ),
                    condition_on_previous_text=False,
                )
                for s in segs:
                    text = s.text.strip()
                    if text and text.lower() not in HALLUCINATIONS:
                        received.append(text)
                        print(f"  🗣  heard: '{text}'")

    print(f"\n Mic test — speak for {duration_seconds}s...")
    print("   Recording ▶")

    with sd.InputStream(
        samplerate=SAMPLE_RATE, channels=1,
        callback=audio_callback, dtype="float32", blocksize=1024,
    ):
        try:
            await asyncio.wait_for(_capture(), timeout=duration_seconds)
        except asyncio.TimeoutError:
            pass

    print("   Recording ■\n")
    assert len(received) >= 1, (
        " No speech detected.\n"
        "    Check mic volume or try: python pilot_asr.py --test --test-mic --seconds 10"
    )
    print(f" _test_mic_live passed  ({len(received)} segment(s) captured)")


# ──────────────────────────────────────────────────────────────
#  DSP TESTS
# ──────────────────────────────────────────────────────────────

async def _test_noise_gate_silence():
    """Silence (zeros) must be zeroed by the gate."""
    gate   = NoiseGate(gate_ratio=2.0)
    silent = np.zeros(1024, dtype=np.float32)
    out    = gate.process(silent)
    assert np.all(out == 0), "Gate should zero a silent chunk"
    print("✅  _test_noise_gate_silence passed")


async def _test_noise_gate_passes_loud_speech():
    """A loud chunk (amplitude 0.5) must pass through the gate."""
    gate  = NoiseGate(gate_ratio=2.0, init_floor=0.001)
    loud  = np.ones(1024, dtype=np.float32) * 0.5
    out   = gate.process(loud)
    assert np.any(out != 0), "Gate should pass a loud chunk"
    print("✅  _test_noise_gate_passes_loud_speech passed")


async def _test_noise_gate_floor_db():
    """floor_db property must return a finite negative number."""
    gate = NoiseGate()
    db   = gate.floor_db
    assert db < 0,            f"Expected negative dBFS, got {db:.1f}"
    assert np.isfinite(db),   f"Expected finite dBFS, got {db}"
    print(f"✅  _test_noise_gate_floor_db passed  (floor={db:.1f}dBFS)")


async def _test_gain_normaliser_targets_peak():
    """
    After several chunks the normaliser should bring the peak
    close to target_peak (within 10%).
    """
    norm   = GainNormaliser(target_peak=0.9, alpha=0.5)
    chunk  = np.ones(1024, dtype=np.float32) * 0.1   # quiet input

    # Run enough chunks for the EMA to settle
    for _ in range(20):
        out = norm.process(chunk)

    peak = float(np.max(np.abs(out)))
    assert 0.7 < peak <= 1.0, f"Expected peak ≈0.9, got {peak:.3f}"
    print(f"✅  _test_gain_normaliser_targets_peak passed  (peak={peak:.3f})")


async def _test_gain_normaliser_clips_at_one():
    """Normaliser must never produce samples outside [-1, 1]."""
    norm  = GainNormaliser(target_peak=0.9, max_gain=20.0)
    loud  = np.ones(1024, dtype=np.float32) * 0.9
    for _ in range(5):
        out = norm.process(loud)
    assert np.all(np.abs(out) <= 1.0), "Hard clip violated"
    print("✅  _test_gain_normaliser_clips_at_one passed")


async def _test_audio_dsp_pipeline():
    """
    End-to-end DSP test: a moderately loud chunk should come out
    normalised and non-zero, and stats() should return a string.
    """
    dsp   = AudioDSP()
    chunk = np.random.randn(1024).astype(np.float32) * 0.3

    # Warm up EMA (first chunk sets noise floor)
    for _ in range(5):
        out = dsp(chunk)

    assert np.any(out != 0),         "DSP zeroed a non-silent chunk"
    assert np.all(np.abs(out) <= 1.0), "DSP output exceeded ±1.0"

    stats = dsp.stats()
    assert "noise_floor=" in stats and "gain=" in stats, \
        f"Unexpected stats format: {stats}"

    print(f"✅  _test_audio_dsp_pipeline passed  ({stats})")


async def _test_dsp_wired_in_callback():
    """
    Verify that audio_callback applies DSP:
    a very quiet chunk should be gated to zeros by the time
    it leaves the queue.
    """
    global _loop, _dsp
    _loop = asyncio.get_event_loop()

    # Fresh DSP with high gate ratio so whisper-quiet input is gated
    _dsp = AudioDSP()
    _dsp.gate.noise_floor = 0.5   # force a high floor estimate

    # Drain any stale items
    while not audio_queue.empty():
        audio_queue.get_nowait()

    # Very quiet input — should be gated to zero
    quiet = np.ones((1024, 1), dtype=np.float32) * 0.001
    audio_callback(quiet, 1024, {}, None)
    result = await asyncio.wait_for(audio_queue.get(), timeout=1.0)

    assert np.all(result == 0), \
        f"Expected gated zeros, max={np.max(np.abs(result)):.4f}"
    print("✅  _test_dsp_wired_in_callback passed")

    # Reset DSP to defaults for subsequent tests
    _dsp = AudioDSP()


async def run_tests(mic: bool = False, mic_seconds: int = 5) -> None:
    print("\n" + "═" * 54)
    print("  PILOT ASR — test suite")
    print("═" * 54)
    await _test_audio_callback()
    await _test_buffer_accumulate()
    await _test_is_speech_silent()
    # ── DSP tests ──────────────────────────────────────────
    await _test_noise_gate_silence()
    await _test_noise_gate_passes_loud_speech()
    await _test_noise_gate_floor_db()
    await _test_gain_normaliser_targets_peak()
    await _test_gain_normaliser_clips_at_one()
    await _test_audio_dsp_pipeline()
    await _test_dsp_wired_in_callback()
    # ── Whisper tests ───────────────────────────────────────
    await _test_transcribe_silent()
    await _test_transcribe_sine()
    await _test_transcribe_and_route_silent()
    await _test_route_schema()
    await _test_speaker_for_span()
    if mic:
        await _test_mic_live(duration_seconds=mic_seconds)
    print("═" * 54)
    print("  All tests passed ✅")
    print("═" * 54 + "\n")


# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    
    if "--test" in sys.argv:
        mic_flag = "--test-mic" in sys.argv
        secs     = 5
        if "--seconds" in sys.argv:
            idx  = sys.argv.index("--seconds")
            secs = int(sys.argv[idx + 1])
        asyncio.run(run_tests(mic=mic_flag, mic_seconds=secs))
    else:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            print("\n[stopped]")


# cp smart-turn/model.py .
# cp smart-turn/inference.py .
# cp smart-turn/audio_utils.py .

# cp smart-turn/audio_utils.py .
# cp smart-turn/inference.py .
# cp smart-turn/model.py .        # if it exists — check
# cp smart-turn/logger.py .  


# cp smart-turn/audio_utils.py .
# cp smart-turn/logger.py .
# python -c "from inference import predict_endpoint; print('OK')"
