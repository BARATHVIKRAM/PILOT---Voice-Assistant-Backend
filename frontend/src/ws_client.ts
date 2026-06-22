/**
 * WebSocket client — /ws/events + /ws/audio.
 * FSE-B owns this.
 */
import type { WSEvent, WSEventType } from "../../contracts/ws_events";

type Handlers = Partial<Record<WSEventType, (payload: unknown) => void>>;

export class PilotWSClient {
  private eventsWs: WebSocket | null = null;
  private audioWs:  WebSocket | null = null;
  private _closed = false;

  constructor(
    private sessionId: string,
    private token: string,
    private handlers: Handlers & { onOpen?: () => void }
  ) {}

  connectEvents() {
    if (this._closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.eventsWs = new WebSocket(
      `${proto}://${location.host}/ws/events/${this.sessionId}?token=${this.token}`
    );
    this.eventsWs.onopen  = () => {
      console.log(`[PILOT] events WS open — session ${this.sessionId.slice(0,8)}`);
      this.handlers.onOpen?.();
    };
    this.eventsWs.onmessage = (e) => {
      try {
        const msg: WSEvent = JSON.parse(e.data);
        if (msg.type !== "ping") {
          console.log(`[PILOT] WS event: ${msg.type}`, msg.payload);
          (this.handlers as Record<string, (p: unknown) => void>)[msg.type]?.(msg.payload);
        }
      } catch { /* ignore parse errors */ }
    };
    this.eventsWs.onclose = () => {
      console.log(`[PILOT] events WS closed — session ${this.sessionId.slice(0,8)}`);
      if (!this._closed) setTimeout(() => this.connectEvents(), 2000);
    };
    this.eventsWs.onerror = (e) => {
      console.error(`[PILOT] events WS error — session ${this.sessionId.slice(0,8)}`, e);
    };
  }

  connectAudio() {
    if (this._closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.audioWs = new WebSocket(`${proto}://${location.host}/ws/audio/${this.sessionId}`);
    this.audioWs.onclose = () => {
      if (!this._closed) setTimeout(() => this.connectAudio(), 2000);
    };
  }

  sendAudio(pcm: ArrayBuffer) {
    if (this.audioWs?.readyState === WebSocket.OPEN) {
      this.audioWs.send(pcm);
    }
  }

  sendPayload(payload: object) {
    if (this.eventsWs?.readyState === WebSocket.OPEN) {
      this.eventsWs.send(JSON.stringify(payload));
    }
  }

  close() {
    this._closed = true;
    this.eventsWs?.close();
    this.audioWs?.close();
  }
}
