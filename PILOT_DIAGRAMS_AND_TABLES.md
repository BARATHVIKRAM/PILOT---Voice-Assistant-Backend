# PILOT Architectural Diagrams, Layout Maps & Performance Tables
This document preserves all core tables, wireframe layouts, and pipeline diagrams generated for PILOT Voice OS.

---

## 1. Main Dashboard Wireframe Layout
*Based on the approved design wireframe mockup*

```
+-------------------------------------------------------------------------------+
|                                 PAGE HEADER                                   |
+------------------------------------------------------+------------------------+
|                                                      |   ✦ Tools Card         |
|                                                      |   - PPT Copilot        |
|                                                      |   - Customer Care      |
|                 📋 Transcript section                |                        |
|                                                      +------------------------+
|                 - General chat logs                  |   ⊙ Queue Card         |
|                 - Inline code generators             |   - Pending Jobs       |
|                 - Dual-level visual scroll bounds    |   - Complete Jobs      |
|                                                      |   - Dual-scroll lock   |
|                                                      |                        |
+------------------------------------------------------+------------------------+
|                                                                               |
|                            🕒 Recent sessions                                 |
|                                                                               |
|     - Full-width scroll list                                                  |
|     - Complete AI session summaries                                           |
|     - Highlighted unsummarized background task details                        |
|                                                                               |
+-------------------------------------------------------------------------------+
```

---

## 2. Dynamic Cognitive Sandbox Trace
*The real-time processing sequence executed on the interactive virtual sandbox*

```mermaid
flowchart TD
    A[🎤 Mic Input DSP] -->|16kHz Chunked Stream| B[🧠 Smart-Turn VAD]
    B -->|Clean Speech Turn Detected| C[⚡ ONNX STT Acoustic Engine]
    C -->|Transcript Output Text| D[🔐 Biometric Speaker ID]
    D -->|Match Admin Level 2 Authorization| E[🧠 Front LLM Route Decision]
    E -->|Route Action: Delegate Write_File| F[⚙️ Concurrent Supervisors]
    F -->|Process Code / Find Flights| G[✓ Spoken Reply & Code Render]

    style A fill:#FFF9E6,stroke:#F5A700,stroke-width:2px
    style B fill:#FFF9E6,stroke:#F5A700,stroke-width:2px
    style C fill:#E6F9EC,stroke:#22C55E,stroke-width:2px
    style D fill:#E6F9EC,stroke:#22C55E,stroke-width:2px
    style E fill:#E6F0FF,stroke:#3B82F6,stroke-width:2px
    style F fill:#E6F0FF,stroke:#3B82F6,stroke-width:2px
    style G fill:#FFF2F2,stroke:#EF4444,stroke-width:2px
```

---

## 3. Core Architecture Pipeline
*Layer mapping of the PILOT Engine*

| Layer Name | Execution Domain | Sub-Systems / Technologies | Purpose |
| :--- | :--- | :--- | :--- |
| **1. Audio DSP Pipeline** | Local Edge | Raw 16kHz Chunking, model-based VAD parameters, ONNX Acoustic STT | Evaluates continuous input stream and extracts clean spoken strings |
| **2. Cognitive Front LLM** | Cloud / Local | Classifier Gateway, Groq Llama-3.1-8B, Biometric verification | Resolves user intent, authorizes access levels, delegates tools |
| **3. Concurrent Supervisors** | Cloud Background | File I/O Workers, MCP Web Services, PowerPoint Supervisors | Executes programmatic tasks asynchronously without blocking voice |

---

## 4. Background Task Latency Profile
*Actual logged performance averages recorded under `audit_log`*

| Task / Tool Name | Latency (ms) | Speed Class | Subsystem Handler |
| :--- | :--- | :--- | :--- |
| **`ppt_navigate`** / **`ppt_jump_to_title`** | **$0.0$ ms** | 🚀 Instantaneous | Local socket context dispatch |
| **`kb_search`** | **$0.0$ ms** | 🚀 Instantaneous | Fast index search query |
| **`database_query`** | **$257.7$ ms** | ⚡ Very Fast | SQLite async engine |
| **`general_qa`** | **$455.4$ ms** | ⚡ Very Fast | Prompt context construction |
| **`write_file`** (Code Gen) | **$557.4$ ms** | ⚡ Very Fast | Real-time script writer |
| **`system_check`** | **$1,195.6$ ms** | ⏱️ Moderate | Filesystem index scanner |
| **`ppt_qa`** | **$1,225.6$ ms** | ⏱️ Moderate | PPT content extractor |
| **`flight_search`** | **$1,819.8$ ms** | ⏱️ Moderate | Node MCP Web integration |

---

## 5. System Architecture & Dual-LLM Routing
*Complete execution flow mapping from sound collection to client presentation updates*

```mermaid
graph TD
    A[Microphone / Webpage] -->|PCM Audio| B(ASR Pipeline: pilot_asr.py)
    B -->|Stage 1: Silero VAD| C{Speech Detected?}
    C -->|Yes| D[Accumulate Speech in Buffer]
    C -->|No / Silence| E{Stage 2: Smart Turn v3}
    E -->|Complete Thought| F[Whisper Transcription]
    E -->|Mid-Sentence Pause| D
    
    F -->|Transcribed Text| G[Dual-LLM Router: call_classifier]
    
    G -->|CONVERSATION| H[Front Agent: front_agent.py]
    G -->|SLIDE_CONTROL| I[Background Agent: _handle_slide_control]
    G -->|BACKGROUND_TASK| J[Background Agent: background_agent.py]
    
    H -->|Direct Answer| K[TTS Streaming Server: tts_server.py]
    I -->|WebSocket Command| L[Slide Server: slide_server.py]
    J -->|Database/MCP/Writes/System Check/Vision Image Q&A| M[Execute Async Subtasks]
    M -->|Synthesized Spoken Report| K
    
    K -->|PCM Chunks via WS| N[Browser Audio Playback]
    L -->|Navigate Command| O[Dashboard & Slides Presentation UI]
```

---

## 6. Distributed Cloud & Edge Architecture
*Physical partition of STT engines, LLM microservices, and client communication channels*

```mermaid
graph LR
    subgraph System A [System A — Whisper STT & WebSocket Orchestrator]
        Mic[User Mic] -->|PCM Audio| ASR[Faster-Whisper]
        ASR -->|Transcribed Text| WS[FastAPI WebSockets Router]
    end

    subgraph System B [System B — Front LLM]
        OllamaB[Ollama: Qwen 8B]
    end

    subgraph System C [System C — Background Agent]
        OllamaC[Ollama: Qwen 8B]
        NodeC[Node.js Flight MCP Server]
    end

    WS -->|HTTP POST /api/chat| OllamaB
    OllamaB -->|JSON RouteDecision| WS
    WS -->|gRPC / HTTP API| OllamaC
    OllamaC -->|Synthesized Spoken WAV| WS
```

---

## 7. Voice Biometric & Guardrails System
*Sequence diagram of security authorization gateways*

```mermaid
graph TD
    UserVoice[Spoken Input] -->|1. Voice Biometrics| BioGate{Registered ID Match?}
    BioGate -->|No| Block1[Discards Command]
    BioGate -->|Yes| RBACGate{2. Role-Based Permissions}
    RBACGate -->|No| Block2[Emits tool_blocked event]
    RBACGate -->|Yes| DestructiveGate{3. Destructive Tool?}
    DestructiveGate -->|Yes| LatchWindow[4. Latch Confirmation Window]
    DestructiveGate -->|No| Exec[5. Programmatic Safe Execution]
```

---

## 8. Local Audio DSP Filter Pipeline
*Local audio cleaning structure*

```mermaid
graph LR
    AudioIn[Raw Audio Chunks] -->|DSP Filters| DSP[RMS Energy Gating]
    DSP -->|Audio Segment| ASR[faster-whisper]
    ASR -->|WER / CER| Eval[Ground Truth Transcript]
```
