/**
 * Globally Shared Microphone Client wrapper for PILOT.
 * Maintains a single, continuous microphone stream and audio event websocket
 * across page transitions (Dashboard, PPT Copilot, Customer Care).
 */
import { useAppStore } from "./store/SessionStore";
import { PilotWSClient } from "./ws_client";
import { AudioCapture } from "./audio_capture";

class SharedVoiceService {
  private sessionId: string | null = null;
  private wsClient: PilotWSClient | null = null;
  private capture: AudioCapture | null = null;
  
  // Callbacks
  private onLevelCallbacks: Set<(lvl: number) => void> = new Set();
  private onStatusCallbacks: Set<(status: string) => void> = new Set();
  private onTranscriptCallbacks: Set<(entry: any) => void> = new Set();
  private onSlideCallbacks: Set<(cmd: any) => void> = new Set();

  private isListening = false;
  private level = 0;
  private status = "Speak or type a command...";
  
  // Audio playback queue
  private audioQ: { buf: ArrayBuffer; mime: string }[] = [];
  private playing = false;
  private audioCtx: AudioContext | null = null;

  constructor() {
    // Unlock AudioContext on first user interaction
    const unlock = () => {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
        if (this.audioCtx.state === "suspended") this.audioCtx.resume();
      }
    };
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  registerLevel(cb: (lvl: number) => void) {
    this.onLevelCallbacks.add(cb);
    cb(this.level);
    return () => this.onLevelCallbacks.delete(cb);
  }

  registerStatus(cb: (status: string) => void) {
    this.onStatusCallbacks.add(cb);
    cb(this.status);
    return () => this.onStatusCallbacks.delete(cb);
  }

  registerTranscript(cb: (entry: any) => void) {
    this.onTranscriptCallbacks.add(cb);
    return () => this.onTranscriptCallbacks.delete(cb);
  }

  registerSlide(cb: (cmd: any) => void) {
    this.onSlideCallbacks.add(cb);
    return () => this.onSlideCallbacks.delete(cb);
  }

  getListening() {
    return this.isListening;
  }

  getSessionId() {
    return this.sessionId;
  }

  sendPayload(payload: object) {
    if (this.wsClient) {
      this.wsClient.sendPayload(payload);
    }
  }

  private setStatus(status: string) {
    this.status = status;
    this.onStatusCallbacks.forEach(cb => cb(status));
  }

  private setLevel(lvl: number) {
    this.level = lvl;
    this.onLevelCallbacks.forEach(cb => cb(lvl));
  }

  async start(usecase = "general") {
    if (this.isListening) return;
    try {
      const store = useAppStore.getState();
      const token = store.token!;
      const r = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ usecase })
      });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const res = await r.json();
      if (!res.session_id) throw new Error("No session_id in response");
      
      this.sessionId = res.session_id;
      store.setSession(this.sessionId);
      store.setIsListeningGlobal(true);
      this.isListening = true;

      this.wsClient = new PilotWSClient(this.sessionId, token, {
        onOpen: () => this.setStatus("Listening..."),
        transcript: (p: any) => {
          this.onTranscriptCallbacks.forEach(cb => cb(p));
          
          // Complete the tool card status ONLY when the final results print on screen
          if (p.job_id) {
            store.upsertToolCard({ job_id: p.job_id, status: "ok" });
          }

          const conf = p.confidence || 0;
          if (p.speaker === "PILOT") {
            this.setStatus("PILOT responded");
          } else if (conf < 0.4 && p.speaker !== "PILOT") {
            this.setStatus(`⚠ Low confidence (${Math.round(conf * 100)}%) — speak clearly`);
            const lowConfEntry = {
              text: `⚠ Speaker confidence low (${Math.round(conf * 100)}%) — voice not clearly identified`,
              speaker: "PILOT", role: "system", confidence: 1.0, timestamp: p.timestamp
            };
            this.onTranscriptCallbacks.forEach(cb => cb(lowConfEntry));
          } else if (p.speaker && p.speaker !== "spk-unknown") {
            this.setStatus(`${p.speaker}: ${p.text.substring(0, 55)}…`);
          }
        },
        tts_audio: (p: any) => {
          if (p.b64) this.enqueueB64Audio(p.b64, p.mime || "audio/mp3");
        },
        tool_start: (p: any) => {
          store.upsertToolCard({ ...p, status: "running" });
          this.setStatus(`Running ${p.tool}...`);
          const startEntry = {
            text: `⚙ Starting: ${p.tool}`, speaker: "PILOT", role: "PILOT",
            confidence: 1, timestamp: Date.now() / 1000
          };
          this.onTranscriptCallbacks.forEach(cb => cb(startEntry));
        },
        tool_end: (p: any) => {
          // Keep the status as "running" - do not set to complete/ok yet until transcript output prints on screen
          store.upsertToolCard({ ...p, status: "running" });
          const r = p.result;
          let msg = `✓ ${p.tool} complete`;
          if (r?.ticket_ref) msg = `✓ Ticket created: ${r.ticket_ref}`;
          if (r?.booking_ref) msg = `✓ Flight booked: ${r.booking_ref}`;
          if (r?.results?.length) msg = `✓ Found ${r.results.length} results`;
          const endEntry = {
            text: msg, speaker: "PILOT", role: "PILOT", confidence: 1, timestamp: Date.now() / 1000
          };
          this.onTranscriptCallbacks.forEach(cb => cb(endEntry));
        },
        job_queued: (p: any) => {
          store.addJob({ ...p, status: "pending" });
          // Register the queued/pending task immediately into the visual Tool Cards registry
          store.upsertToolCard({ job_id: p.job_id, tool: p.tool, status: "pending", speaker: p.requester });
        },
        confirm_prompt: (p: any) => store.setConfirm(p),
        route_decision: (p: any) => {
          if (p.action === "delegate") this.setStatus(`On it — ${p.tool}...`);
          if (p.action === "respond_now") this.setStatus("PILOT responding...");
        },
        session_state: (p: any) => {
          const labels: Record<string, string> = {
            IDLE: "Idle", LISTENING: "Listening...", PROCESSING: "Processing speech...",
            DELEGATING: "Running task...", SPEAKING: "PILOT speaking...",
            INTERRUPTED: "Interrupted", ENDED: "Session ended"
          };
          this.setStatus(labels[p.state] || p.state);
        },
        ppt_command: (p: any) => {
          window.dispatchEvent(new CustomEvent("ppt_command", { detail: p }));
          this.onSlideCallbacks.forEach(cb => cb(p));
        },
      });

      this.wsClient.connectEvents();
      this.wsClient.connectAudio();

      this.capture = new AudioCapture(
        (buf) => this.wsClient?.sendAudio(buf),
        (lvl) => this.setLevel(lvl)
      );
      await this.capture.start();
      this.setStatus("Listening...");
    } catch (e: any) {
      this.setStatus("Mic error: " + e.message);
      this.stop();
    }
  }

  stop() {
    const store = useAppStore.getState();
    this.capture?.stop();
    this.capture = null;
    this.wsClient?.close();
    this.wsClient = null;
    this.isListening = false;
    store.setIsListeningGlobal(false);
    this.setStatus("Session ended");
    store.setSession("");
    this.sessionId = null;
  }

  toggle(usecase = "general") {
    if (this.isListening) this.stop(); else this.start(usecase);
  }

  private async playQueue() {
    if (this.playing || this.audioQ.length === 0) return;
    this.playing = true;
    this.setStatus("PILOT speaking...");
    while (this.audioQ.length > 0) {
      const { buf, mime } = this.audioQ.shift()!;
      try {
        if (!this.audioCtx) this.audioCtx = new AudioContext();
        if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
        const decoded = await this.audioCtx.decodeAudioData(buf.slice(0));
        await new Promise<void>(res => {
          const src = this.audioCtx!.createBufferSource();
          src.buffer = decoded;
          src.connect(this.audioCtx!.destination);
          src.onended = () => res();
          src.start(0);
        });
      } catch {
        await new Promise<void>(res => {
          const blob = new Blob([buf], { type: mime });
          const url = URL.createObjectURL(blob);
          const a = new Audio(url);
          a.onended = () => { URL.revokeObjectURL(url); res(); };
          a.onerror = () => { URL.revokeObjectURL(url); res(); };
          a.play().catch(() => res());
        });
      }
    }
    this.playing = false;
    this.setStatus("Listening...");
  }

  private enqueueB64Audio(b64: string, mime = "audio/mp3") {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      this.audioQ.push({ buf: bytes.buffer, mime });
      this.playQueue();
    } catch (e) {
      console.error("audio decode error", e);
    }
  }
}

export const sharedVoiceService = new SharedVoiceService();
