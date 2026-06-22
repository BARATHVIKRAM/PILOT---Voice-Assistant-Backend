/**
 * WS event types — TypeScript side (frontend).
 * Mirror of ws_events.py. FSE-AB keep both in sync.
 */

export type WSEventType =
  | "transcript"
  | "tool_start"
  | "tool_end"
  | "job_queued"
  | "confirm_prompt"
  | "ppt_command"
  | "tts_audio"
  | "tool_blocked"
  | "route_decision"
  | "session_state"
  | "barge_in"
  | "ping";

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
}

export interface TranscriptPayload {
  text: string;
  speaker: string | null;
  role: string | null;
  confidence: number;
  timestamp: number;
}

export interface ToolStartPayload {
  job_id: string;
  tool: string;
  speaker: string | null;
  role: string | null;
}

export interface ToolEndPayload {
  job_id: string;
  tool: string;
  result: Record<string, unknown>;
  latency_ms?: number;
}

export interface ConfirmPromptPayload {
  tool: string;
  speaker: string;
  message: string;
}

export interface PPTCommandPayload {
  action: "next" | "prev" | "first" | "last" | "goto";
  index?: number;
}

export interface JobQueuedPayload {
  job_id: string;
  tool: string;
  requester: string | null;
  mode: "queue" | "interrupt";
}
