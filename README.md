# PILOT — Portable Intelligent Listener for Open Tasking

> **Grid Dynamics Capstone 2026 · Team of 6 (3 DS · 2 FSE · 1 DevOps)**
>
> Always-on ambient voice AI copilot. Knows who is speaking. Reacts in under 300ms.
> Delegates long-running work safely behind RBAC. Never blocks the conversational loop.

---

## Table of Contents

1. [What PILOT Is](#1-what-pilot-is)
2. [Full End-to-End Flow](#2-full-end-to-end-flow)
3. [Every Concept Explained](#3-every-concept-explained)
4. [Folder Structure](#4-folder-structure)
5. [Who Owns What](#5-who-owns-what)
6. [Use Cases Deep Dive](#6-use-cases-deep-dive)
7. [Getting Started](#7-getting-started)
8. [Provider Swap Matrix](#8-provider-swap-matrix)
9. [API + WebSocket Reference](#9-api--websocket-reference)
10. [Why Monolith](#10-why-monolith)

---

## 1. What PILOT Is

PILOT is a **real-time, always-on voice pipeline** — not a push-to-talk assistant,
not a wake-word device. The microphone is always open. The system listens continuously,
separates speakers by identity, transcribes, classifies intent, gates actions behind
speaker role, and executes tools asynchronously — all while keeping the live
conversational loop alive at under 300ms.

### Two demo use cases

| Use Case | Core challenge proved |
|---|---|
| **PPT Copilot** | Semantic classification: "next slide" fires; "and next we should discuss..." does not |
| **Customer Care / Flight Booking** | Duplex two-speaker capture; CSR-only tool access; background agent fills ticket while CSR is still talking |

---

## 2. Full End-to-End Flow

```
┌───────────────────────────────────────────────────────────────────┐
│  BROWSER (React 18 + Zustand + TypeScript)                        │
│                                                                   │
│  getUserMedia({sampleRate:16000, channelCount:1})                 │
│  AudioWorklet → Int16Array PCM chunks                             │
│     └─→  WebSocket  /ws/audio/{session_id}  (binary)             │
│                                                                   │
│  WebSocket  /ws/events/{session_id}  ←── JSON events from server  │
│  Handlers: transcript · tool_start · tool_end · job_queued        │
│            confirm_prompt · ppt_command · tts_audio               │
│                                                                   │
│  Components: TranscriptOverlay · ToolStatusCard · BacklogQueue    │
│              EnrollmentCapture · PPTView · FlightView             │
└────────────────────┬──────────────────────────────────────────────┘
                     │  PCM bytes (16kHz mono Int16)
                     ▼
┌───────────────────────────────────────────────────────────────────┐
│  FASTAPI MONOLITH (Python 3.11, single asyncio event loop)        │
│                                                                   │
│  api/ws_audio.py                                                  │
│    websocket.receive_bytes()                                      │
│    → bus.raw_audio_q.put_nowait(RawAudioChunk)                    │
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  LAYER 1 — SILERO VAD  (pipeline/vad/silero_vad.py)               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  Consumes: raw_audio_q                                            │
│  Action:   reads 30ms PCM frames                                  │
│            services/vad.py → SileroVADProvider.is_speech(frame)  │
│            energy RMS > 300  →  speech frame                     │
│            12 silence frames (360ms) after speech  →  turn end   │
│  Emits:    TurnSegment(pcm, session_id, timestamp) → turn_q      │
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  LAYER 2 — SMART TURN  (pipeline/vad/smart_turn.py)               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  Consumes: turn_q                                                 │
│  Action:   Whisper-Tiny partial decode + linear classifier        │
│            "Is this utterance linguistically complete?"           │
│            YES → forward to diarizer                              │
│            NO  → discard (Silero re-emits on next silence window) │
│  Note:     prevents mid-sentence cutoff on natural pauses         │
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  LAYER 3 — DIARIZER  (pipeline/diarizer.py)                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  Consumes: turn_q                                                 │
│  Action:   services/diarizer.py → SortformerProvider (primary)   │
│                                   PyannoteProvider   (fallback)   │
│            Segments audio → pseudo-labels: spk-0, spk-1, spk-2   │
│  Emits:    LabeledTurn(speaker_label=spk-0, ...) → labeled_turn_q│
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  LAYER 4 — IDENTITY RESOLVER (pipeline/identity_resolver.py)      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  Consumes: labeled_turn_q                                         │
│  Action:   services/enrollment.py → WeSpeakerEmbedProvider       │
│            extract_embedding(pcm) → 512-dim float32 vector        │
│            cosine_similarity(embedding, each_enrolled_embedding)  │
│            score ≥ 0.82 → map to (speaker_id, role, confidence)  │
│            score < 0.82 → "spk-unknown"                           │
│  Emits:    LabeledTurn (speaker_id, role, confidence patched)    │
│            → labeled_turn_q                                       │
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  LAYER 5 — ASR WORKER  (pipeline/asr_worker.py)                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  Consumes: labeled_turn_q                                         │
│  Action:   services/stt.py → WhisperSTTProvider                   │
│            faster-whisper distil-large-v3 INT8                    │
│            asyncio.to_thread (non-blocking)                       │
│  Dual-write:                                                      │
│    a) core/session_state.py ring buffer (last 50 spans, memory)  │
│    b) db/models.TranscriptLog (SQLite, permanent)                 │
│  Emits:                                                           │
│    bus.event_q → "transcript" event → /ws/events → browser       │
│    TranscriptSpan → transcript_q                                  │
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  LAYER 6 — FRONT LLM  (pipeline/front_llm.py)                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  Consumes: transcript_q                                           │
│  Action:   services/front_llm.py → FrontLLMProvider               │
│            Qwen3:8B via Ollama (local, ~80ms on CPU)             │
│            Input: text + speaker_id + role + ring buffer context  │
│            Output (JSON mode):                                    │
│              { action, preamble, tool, args, mode }               │
│                                                                   │
│  RouteDecision.action = "ignore"                                  │
│    → drop, nothing happens                                        │
│                                                                   │
│  RouteDecision.action = "respond_now"                             │
│    → services/tts.py → EdgeTTSProvider (primary) / Kokoro (fb)   │
│    → stream WAV chunks → bus.event_q "tts_audio" → browser       │
│                                                                   │
│  RouteDecision.action = "delegate"                                │
│    → tools/policy.py → PolicyGate.check(tool, speaker_id, role)  │
│         RBAC: role perms table lookup                             │
│         if destructive: emit confirm_prompt → same-speaker latch  │
│         allowed → core/bg_supervisor.py → BGSupervisor.submit()  │
│                                                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  BACKGROUND AGENT (core/bg_supervisor.py + services/bg_agent.py) │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│                                                                   │
│  mode=interrupt → cancel current Task → start new                │
│  mode=queue     → append to job queue                             │
│                                                                   │
│  services/bg_agent.py → GeminiAgentProvider (primary)            │
│                          GroqAgentProvider (fallback)             │
│  → tools/registry.py → TOOL_REGISTRY[tool_name](args, session)   │
│  → tool handlers: ppt_copilot · tickets · knowledge · crm · flights│
│                                                                   │
│  Streams events: job_queued → tool_start → tool_end               │
│  All via bus.event_q → api/ws_events.py → /ws/events → browser   │
│                                                                   │
│  AUDIT: db/models.AuditLog written on every policy decision       │
│    (speaker_id, role, confidence, action, tool, decision, latency)│
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. Every Concept Explained

### PCM (Pulse Code Modulation)
Raw digital audio. The browser captures at 16kHz, mono, 16-bit signed integers.
Every millisecond of audio is 32 bytes. The pipeline operates entirely on PCM until
ASR converts it to text.

### WebSocket Audio Channel `/ws/audio`
A persistent binary WebSocket where the browser streams PCM chunks continuously.
Unlike HTTP (request-response), the connection stays open — audio flows without
handshake overhead. On the server, each received binary message becomes a
`RawAudioChunk` dropped into `raw_audio_q`.

### QueueBus (`queues/bus.py`)
The shared nervous system. Five `asyncio.Queue` objects:

| Queue | Data type | From → To |
|---|---|---|
| `raw_audio_q` | `RawAudioChunk` | WS audio → Silero VAD |
| `turn_q` | `TurnSegment` | VAD → SmartTurn → Diarizer |
| `labeled_turn_q` | `LabeledTurn` | Diarizer+Identity → ASR |
| `transcript_q` | `TranscriptSpan` | ASR → Front LLM |
| `event_q` | `PipelineEvent` | Everything → /ws/events → Browser |

All queues have `maxsize` — producers block when full (backpressure). The UI can
be slow; the pipeline never corrupts memory.

### Silero VAD (Energy Gate)
Reads 30ms audio frames. Computes RMS energy. Above threshold → speech. After
12 consecutive silence frames (360ms) following speech → emits a `TurnSegment`.
This is **coarse** — it only detects whether audio contains voice at all.

### Smart Turn (Semantic VAD)
Built on Whisper-Tiny + a linear classifier. Answers: "Is this utterance
**linguistically complete**?" If someone pauses mid-sentence in a natural breath,
Smart Turn holds and waits. If they say "next slide", Smart Turn fires immediately.
This is why PILOT never cuts speakers mid-thought.

### `TurnSegment`
`{pcm, session_id, timestamp, duration_ms}` — a complete audio span ready for
speaker separation and transcription.

### Diarizer (Sortformer / pyannote)
Segments the audio and assigns **pseudo-labels**: `spk-0`, `spk-1`, etc.
It does not know real names — it only knows there are distinct voices.
Sortformer (NVIDIA) handles up to 4 speakers in real time. pyannote.audio is the
fallback for environments where Sortformer is unavailable.

### Identity Resolver + WeSpeaker Embeddings
The enrollment flow: when a user signs up, they read a passage aloud. The
`EmbedProvider` runs the WeSpeaker ECAPA model and produces a **512-dimensional
float32 vector** (a voice fingerprint). This is stored as a `.npy` file and a
binary blob in SQLite.

At runtime, for each diarized segment:
1. Extract embedding from the segment's PCM
2. Compute **cosine similarity** against all enrolled embeddings
3. If best score ≥ 0.82: map to `(speaker_name, role, confidence)`
4. If best score < 0.82: label as `spk-unknown`

**Cosine similarity** measures the angle between two vectors. Two recordings of
the same voice produce nearly parallel vectors (score near 1.0). Different voices
produce less-aligned vectors (score < 0.82).

### `LabeledTurn`
`{pcm, session_id, speaker_label, speaker_id, role, confidence}` — the audio now
carries identity and authorization context.

### ASR — Faster-Whisper distil-large-v3
Converts labeled PCM to text. `distil-large-v3` is a knowledge-distilled version
of Whisper large-v3 — 4× smaller, 6× faster, 99% of the accuracy. INT8
quantization reduces it further. Runs on CPU via `asyncio.to_thread` so it
doesn't block the event loop.

**Dual-write:**
- In-memory ring buffer (`core/session_state.py`, last 50 spans) for Front LLM context
- SQLite `transcript_log` table for permanent audit trail

### Ring Buffer
A `collections.deque(maxlen=50)` per session. The front LLM reads from here on
every classification — **not** from SQLite. Memory access = microseconds.
SQLite access = milliseconds. This is a key part of hitting the 300ms budget.

### Front LLM — Qwen3:8B (Ollama local)
The intelligence layer. Takes the current `TranscriptSpan` + last 8 entries from
the ring buffer. Uses a structured system prompt to output JSON:

```json
{
  "action": "ignore" | "respond_now" | "delegate",
  "preamble": "short spoken ack (≤10 words) or null",
  "tool": "tool_name or null",
  "args": {},
  "mode": "queue" | "interrupt"
}
```

**Why local?** Cloud LLM round-trip = 500–1500ms. Qwen3:8B quantized on CPU = ~80ms.
The front LLM must respond within ~100ms to stay in the 300ms budget.

**Why small?** It does one thing: classify intent and produce structured JSON.
It does **not** execute tools, does **not** generate long text, does **not** reason
over documents. Deep work lives in the background agent.

### `RouteDecision`
The output of the front LLM, wrapped as a typed dataclass:
`{action, preamble, tool, args, mode, speaker_id, role, session_id}`

### TTS — Edge TTS + Kokoro
**`respond_now`:** a short preamble ("Got it, creating ticket.") goes to
`services/tts.py`. Edge TTS (Microsoft Neural TTS, free, streaming) starts
sending WAV chunks **before** the full sentence is rendered. First audio arrives
at the browser in ~200ms. Kokoro (local Rust-based model) is the offline fallback.

### Interrupt Handler (`core/cancel_tokens.py`)
If the user speaks **while PILOT is playing TTS**, the cancel token mechanism:
1. Cancels the in-flight TTS streaming `asyncio.Task`
2. Drains the audio output buffer
3. The new PCM flows through the pipeline fresh

This is what makes PILOT feel like a real conversation, not a command-response cycle.

### Policy Gate (`tools/policy.py`)
Before any tool call:

1. **Role check:** is `role` in `ROLE_PERMS[tool]`?
2. **Destructive check:** is `tool` in `DESTRUCTIVE_TOOLS`?
3. If destructive → emit `confirm_prompt` event → browser shows confirmation UI
   → latch window (10s): wait for **same `speaker_id`** to confirm
   → wrong speaker or timeout → **fail closed** + audit log
4. If all checks pass → submit to `BGSupervisor`

**Identity-bound confirmation** is critical: if Alice says "book flight FL001"
and Bob says "yes confirm", the action is blocked. Only Alice can confirm her
own destructive request.

### BGSupervisor (`core/bg_supervisor.py`)
Manages concurrent background jobs:
- `mode=interrupt`: cancels any currently running job (`asyncio.Task.cancel()`)
- `mode=queue`: appends to FIFO queue, processes in order
- Emits `job_queued → tool_start → tool_end` events throughout execution

### Background Agent (`services/bg_agent.py`)
Gemini free tier (primary) / Groq API (fallback). Runs the actual tool loop.
Does **not** talk to the user — only emits state events to `event_q`. Results
feed back into the ring buffer context for the next front LLM call.

### `event_q` → `/ws/events`
Every piece of observable state flows through here as JSON events.
`api/ws_events.py` routes each event to the correct session's WebSocket connections.
The browser's `PilotWSClient` dispatches each event type to its handler.

### Audit Log (`db/models.AuditLog`)
Every policy decision, every tool call, every speaker identification attempt
is written as an immutable row:
`(session_id, speaker_id, role, confidence, action, tool, decision, latency_ms, timestamp)`

You can replay exactly who authorized what, when, with what confidence.

### Session State Machine (`core/session_manager.py`)
States: `IDLE → LISTENING → PROCESSING → DELEGATING → SPEAKING → INTERRUPTED → ENDED`
Transitions driven by: new audio, RouteDecision, barge-in, job completion.
Persisted to SQLite via `core/persistence.py` — enables WebSocket reconnect
without losing ring buffer context.

---

## 4. Folder Structure

```
PILOT/
├── Makefile
├── README.md
│
├── backend/                         FSE-A primary
│   ├── main.py                      App factory + lifespan
│   ├── requirements.txt
│   ├── pyproject.toml               ruff + pytest config
│   ├── .env.example
│   │
│   ├── core/                        FSE-A
│   │   ├── config.py                pydantic-settings, all env vars
│   │   ├── session_manager.py       active session registry
│   │   ├── session_state.py         PCM → VAD/ASR ring buffer + state
│   │   ├── audio_fanout.py          PCM → VAD/diar fanout
│   │   ├── cancel_tokens.py         concurrency cancel tokens
│   │   ├── bg_supervisor.py         background job scheduler
│   │   ├── persistence.py           snapshot save/load (reconnect)
│   │   ├── ws_manager.py            WS connection pool
│   │   ├── security.py              JWT, bcrypt, OTP
│   │   └── events.py                startup/shutdown hooks
│   │
│   ├── services/                    DS owners
│   │   ├── vad.py      DS-C         VAD provider interface
│   │   ├── stt.py      DS-C         STT provider interface
│   │   ├── tts.py      DS-C         TTS provider interface
│   │   ├── diarizer.py DS-B         diarizer provider interface
│   │   ├── enrollment.py DS-A/B     enrollment + cosine ID
│   │   ├── front_llm.py DS-A        front LLM provider + prompts
│   │   └── bg_agent.py  FSE-A       background agent provider
│   │
│   ├── pipeline/                    asyncio Task workers
│   │   ├── vad/
│   │   │   ├── silero_vad.py        energy gate, 30ms frames
│   │   │   └── smart_turn.py        semantic completeness classifier
│   │   ├── diarizer.py              Sortformer/pyannote → pseudo-labels
│   │   ├── identity_resolver.py     cosine sim → speaker_id + role
│   │   ├── asr_worker.py            faster-whisper → TranscriptSpan
│   │   └── front_llm.py             Qwen3:8B → RouteDecision
│   │
│   ├── tools/                       DS-A / FSE-A
│   │   ├── registry.py              TOOL_REGISTRY dict
│   │   ├── policy.py                RBAC + confirmation gate
│   │   ├── ppt_copilot.py           ppt_navigate, ppt_jump_to_title
│   │   ├── flight_booking.py        flight_search, flight_book
│   │   ├── tickets.py               ticket_create/update/close
│   │   ├── knowledge.py             kb_search
│   │   └── crm.py                   crm_lookup
│   │
│   ├── api/                         FSE-A
│   │   ├── auth.py                  POST /auth/signup|login|verify-otp
│   │   ├── sessions.py              POST/GET/DELETE /sessions
│   │   ├── enrollment.py            GET/POST /enrollment
│   │   ├── transcripts.py           GET /transcripts/{session_id}
│   │   ├── ppt.py                   POST /ppt/navigate
│   │   ├── flights.py               POST /flights/search|book
│   │   ├── ws_audio.py              WS /ws/audio/{session_id} ← PCM
│   │   └── ws_events.py             WS /ws/events/{session_id} ← push
│   │
│   ├── db/                          FSE-A
│   │   ├── engine.py                async engine + sessionmaker
│   │   ├── models.py                all ORM models
│   │   └── migrations/              alembic (future)
│   │
│   ├── queues/
│   │   └── bus.py                   QueueBus singleton + dataclasses
│   │
│   ├── schemas/
│   │   └── ws_events.py             Pydantic WS event schemas
│   │
│   └── tests/                       FSE-A + DevOps
│       ├── conftest.py
│       ├── test_session_state.py
│       ├── test_audio_fanout.py
│       ├── test_bg_supervisor.py
│       └── test_tools.py
│
├── frontend/                        FSE-B primary
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── public/slides/index.html     reveal.js demo deck
│   └── src/
│       ├── app.tsx                  root + WS init
│       ├── ws_client.ts             WS client + event bus
│       ├── audio_capture.ts         mic → PCM → ...
│       ├── components/
│       │   ├── TranscriptOverlay.tsx   live transcript + speaker labels
│       │   ├── ToolStatusCard.tsx      tool call status cards
│       │   ├── BacklogQueue.tsx        background job queue UI
│       │   ├── EnrollmentCapture.tsx   voice enrollment UX
│       │   ├── SessionHeader.tsx       session status header + landing
│       │   ├── PPTView.tsx             PPT copilot demo view
│       │   └── FlightView.tsx          flight booking demo view
│       └── store/
│           ├── SessionStore.ts         Zustand global app state
│           ├── TranscriptStore.ts      transcript ring buffer
│           └── toolStore.ts            tool invocation state
│
├── infra/                           DevOps
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   ├── docker-compose.yml
│   └── .devcontainer/devcontainer.json
│
├── contracts/                       FSE-AB shared
│   ├── ws_events.py                 WS message schemas (Python)
│   └── ws_events.ts                 WS message types (TS mirror)
│
└── .github/
    └── workflows/ci.yml             lint + test on every PR
```

---

## 5. Who Owns What

| Person | Seat | Key files |
|---|---|---|
| **DS-A** | Interaction Layer — Front LLM, TTS, interruption, RBAC policy | `services/front_llm.py`, `services/tts.py`, `pipeline/front_llm.py`, `services/enrollment.py`, `tools/registry.py`, `tools/policy.py` |
| **DS-B** | Speaker Stack — diarization, embeddings, identity | `services/diarizer.py`, `services/enrollment.py`, `pipeline/diarizer.py`, `pipeline/identity_resolver.py` |
| **DS-C** | Speech IO — ASR, VAD, TTS streaming | `services/vad.py`, `services/stt.py`, `services/tts.py`, `pipeline/vad/`, `pipeline/asr_worker.py` |
| **FSE-A** | Backend infrastructure — sessions, WS, DB, bg supervisor | `main.py`, `core/`, `api/`, `db/`, `queues/bus.py`, `services/bg_agent.py` |
| **FSE-B** | Frontend — React SPA, WS client, audio capture, all UI | `frontend/src/` entirely |
| **DevOps** | Infra, CI, model downloads, synthetic fixtures | `infra/`, `.github/`, `Makefile`, `backend/tests/` |

---

## 6. Use Cases Deep Dive

### PPT Copilot

**What it proves:** The line between conversational noise and a real command.

```
User speaks: "and next we should look at the architecture"
Silero VAD:  speech detected → TurnSegment emitted
SmartTurn:   complete utterance ✓
Diarizer:    spk-0
Identity:    Alice (developer, conf=0.91)
ASR:         "and next we should look at the architecture"
Front LLM:   → action: "ignore"  (negative example in system prompt)
Result:      NOTHING HAPPENS ✓

User speaks: "go to the architecture slide"
ASR:         "go to the architecture slide"
Front LLM:   → action: "delegate", tool: "ppt_jump_to_title", args: {query: "architecture"}
Policy gate: developer role → allowed
BGSupervisor: job submitted
ppt_jump_to_title: fuzzy match → slide index 2
bus.emit_event("ppt_command", {action:"goto", index:2}, session_id)
Browser:      iframe.postMessage({action:"goto",index:2}) → slide advances ✓
```

### Customer Care / Flight Booking

**What it proves:** Duplex speaker separation + RBAC enforcement.

```
CSR Alice (enrolled, role=csr) and Customer Bob (unenrolled) both speaking.

Diarizer:        spk-0 (Alice), spk-1 (Bob)
Identity:        Alice → csr, confidence=0.93
                 Bob   → spk-unknown, role=null, confidence=0.41

Bob says:  "Please book flight FL001 for me"
Front LLM: → action: "delegate", tool: "flight_book"
Policy:    role=null → RBAC denied → tool_blocked event → UI shows block ✓

Alice says: "Book flight FL001 for Bob Smith"
Front LLM: → action: "delegate", tool: "flight_book"
Policy:    role=csr → in ROLE_PERMS["csr"] ✓
           flight_book is DESTRUCTIVE → confirm_prompt emitted
Browser:   shows confirmation banner
Alice says: "yes confirm"
Policy:    same speaker_id (Alice) → confirmed ✓
BGSupervisor: flight_book("FL001", "Bob Smith") → booking_ref: BKAB12CF
tool_end event → ToolStatusCard updates in UI ✓
```

---

## 7. Getting Started

### Prerequisites
- Python 3.11+
- Node.js 20+
- [Ollama](https://ollama.ai) installed and running
- ffmpeg

### Backend

```bash
# 1. Clone
git clone <repo-url> && cd PILOT

# 2. Install
cd backend
pip install -r requirements.txt

# 3. Configure
cp .env.example .env
# Edit .env — add GEMINI_API_KEY for background agent

# 4. Pull Qwen3:8b (in a separate terminal)
ollama serve
ollama pull qwen3:8b

# 5. Run
uvicorn main:app --port 8000 --reload
# or from project root: make dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev       # dev server on :5173 (proxies /api and /ws to :8000)
# or: npm run build → serves via FastAPI static
```

### Dev mode OTP
When `SMTP_USER` is not configured, OTPs print directly to the server console:
```
================================================
DEV — OTP for user@example.com: 482910
================================================
```

### First run
1. `http://localhost:5173` → landing page
2. **Get Started** → name, email, role → OTP sent (check console)
3. Verify OTP → record voice enrollment passage
4. Dashboard → choose PPT Copilot or Customer Care
5. 🎤 → speak

---

## 8. Provider Swap Matrix

All subsystems sit behind abstract interfaces. Cloud migration = one env var + one class.

| Component | Env var | Dev default | Cloud alternative |
|---|---|---|---|
| ASR | `ASR_PROVIDER` | faster-whisper | Deepgram / AssemblyAI |
| VAD | `VAD_PROVIDER` | Smart Turn v3 | bundled in RT APIs |
| Diarizer | `DIAR_PROVIDER` | pyannote | AssemblyAI diarize |
| Speaker embed | `EMBED_PROVIDER` | WeSpeaker ECAPA | Resemble AI |
| Front LLM | `FRONT_LLM_PROVIDER` | Qwen3:8B Ollama | gpt-4.1-mini |
| Background LLM | `BG_LLM_PROVIDER` | Gemini free | Groq / o4-mini |
| TTS | `TTS_PROVIDER` | Edge TTS | ElevenLabs |

No other code changes needed — provider interface is the only seam.

---

## 9. API + WebSocket Reference

### REST

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/signup` | Create account → OTP sent |
| POST | `/api/v1/auth/send-otp` | Resend OTP |
| POST | `/api/v1/auth/verify-otp` | Verify → JWT |
| POST | `/api/v1/auth/login` | Login → JWT |
| POST | `/api/v1/sessions` | Create session `{usecase}` |
| GET  | `/api/v1/sessions/{id}` | Get session state |
| DELETE | `/api/v1/sessions/{id}` | End session |
| GET  | `/api/v1/enrollment` | List enrolled speakers |
| POST | `/api/v1/enrollment/start` | Start `{name, role}` |
| POST | `/api/v1/enrollment/audio` | Submit voice audio |
| POST | `/api/v1/enrollment/finalize/{id}` | Mark ready |
| DELETE | `/api/v1/enrollment/{id}` | Remove |
| GET  | `/api/v1/transcripts/{session_id}` | Full transcript |
| POST | `/api/v1/ppt/navigate` | PPT command |
| POST | `/api/v1/flights/search` | Flight search |
| POST | `/api/v1/flights/book` | Flight booking |

### WebSockets

| Endpoint | Direction | Content |
|---|---|---|
| `/ws/audio/{session_id}` | Browser → Server | Binary PCM Int16 chunks |
| `/ws/events/{session_id}` | Server → Browser | JSON pipeline events |

### Event Types (`/ws/events`)

| Type | Payload | Description |
|---|---|---|
| `transcript` | `{text, speaker, role, confidence, timestamp}` | New transcribed turn |
| `tool_start` | `{job_id, tool, speaker, role}` | Execution started |
| `tool_end` | `{job_id, tool, result, latency_ms}` | Execution complete |
| `job_queued` | `{job_id, tool, requester, mode}` | Job added to queue |
| `confirm_prompt` | `{tool, speaker, message}` | Confirmation required |
| `ppt_command` | `{action, index?}` | Navigate slides |
| `tts_audio` | `{chunk: number[]}` | Audio chunk for playback |
| `tool_blocked` | `{tool, speaker, reason}` | RBAC rejected |
| `route_decision` | `{action, tool, speaker}` | Front LLM classification |
| `ping` | `{}` | Keep-alive |

---

## 10. Why Monolith

PILOT is a **single FastAPI process**. This is a deliberate design choice:

**1. The pipeline is one asyncio execution graph.**
All queues are in-process `asyncio.Queue` objects. Every hop costs nanoseconds.
Splitting into microservices means adding a message broker — 30–80ms per hop.
With a 300ms total budget and 6 pipeline stages, you cannot afford broker hops.

**2. Front LLM needs zero-copy ring buffer access.**
Reading the last 8 transcript spans is one Python attribute access in a monolith.
As a microservice it's an HTTP round-trip (~10–50ms) that eats the latency budget.

**3. SQLite is single-writer.**
It does not support concurrent writes from multiple processes. Microservices
force a migration to PostgreSQL before the first demo.

**4. Team size and timeline.**
Microservices require separate CI pipelines, Docker containers, service mesh,
distributed tracing, and inter-service auth. That's 2–3 weeks of overhead for
a 6-week capstone.

**5. Provider interfaces already handle swap-ability.**
If Qwen3:8B needs to run on a dedicated GPU machine later, wrap it in one
`LLMProvider` class and one HTTP call. No architecture change. No service mesh.

**Graduation path:** monolith → profile → extract exactly one bottleneck
(e.g., ASR as a sidecar) via the provider interface. One-class change.

---

*PILOT — Grid Dynamics Capstone 2026*



cd backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload


 make frontend-dev
cd frontend && npm run dev


sqlite3 backend/data/pilot.db "SELECT id, name, email, role, is_active, length(embedding) AS blob_size_bytes FROM users;"




# Set host to listen to all incoming network interfaces
OLLAMA_HOST=0.0.0.0:11434 ollama serve


OLLAMA_HOST=0.0.0.0:11434 ollama serve



# ── SPEECH STT (Runs locally on System A) ──
ASR_PROVIDER=whisper
WHISPER_MODEL=distil-large-v3

# ── FRONT LLM (Routes HTTP requests to System B) ──
FRONT_LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://192.168.1.15:11434   # <--- System B's IP!
OLLAMA_MODEL=qwen3:8b

# ── BACKGROUND AGENT (Routes HTTP requests to System C) ──
BG_LLM_PROVIDER=ollama
# If you want to use Gemini for background work:
# GEMINI_API_KEY=your-api-key 

# If routing Background Ollama to System C:
# OLLAMA_BASE_URL=http://192.168.1.20:11434  # <--- System C's IP!



pagupta@C17657 PILOT % sqlite3 backend/data/pilot.db "SELECT id, name, email, role, is_active, length(embedding) AS blob_size_bytes FROM users;"


ollama serve

ollama pull qwen3.5:2b