/**
 * Tool invocation state — FSE-B owns this.
 */
import { create } from "zustand";

export interface ToolInvocation {
  job_id: string; tool: string; status: "running" | "ok" | "error" | "cancelled";
  speaker?: string; result?: unknown; latency_ms?: number; timestamp: number;
}

interface ToolState {
  invocations: ToolInvocation[];
  upsert: (t: Partial<ToolInvocation> & { job_id: string }) => void;
  clear:  () => void;
}

export const useToolStore = create<ToolState>((set) => ({
  invocations: [],
  upsert: (t) => set((s) => {
    const idx = s.invocations.findIndex((x) => x.job_id === t.job_id);
    if (idx >= 0) {
      const arr = [...s.invocations];
      arr[idx] = { ...arr[idx], ...t } as ToolInvocation;
      return { invocations: arr };
    }
    return { invocations: [...s.invocations, { timestamp: Date.now(), ...t } as ToolInvocation] };
  }),
  clear: () => set({ invocations: [] }),
}));
