/**
 * Transcript store — ring buffer helpers.
 * FSE-B owns this.
 */
import { create } from "zustand";
import type { TranscriptEntry } from "./SessionStore";

interface TranscriptState {
  entries: TranscriptEntry[];
  add:   (e: TranscriptEntry) => void;
  clear: () => void;
  exportTxt: () => string;
}

export const useTranscriptStore = create<TranscriptState>((set, get) => ({
  entries: [],
  add:   (e) => set((s) => ({ entries: [...s.entries.slice(-499), e] })),
  clear: ()  => set({ entries: [] }),
  exportTxt: () =>
    get().entries
      .map((e) => `[${new Date(e.timestamp * 1000).toLocaleTimeString()}] ${e.speaker ?? "?"}: ${e.text}`)
      .join("\n"),
}));
