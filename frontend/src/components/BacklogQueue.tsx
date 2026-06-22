/**
 * BacklogQueue — background job queue visualizer.
 * FSE-B owns this.
 */
import React from "react";

interface Job {
  job_id: string; tool: string; status: string; requester?: string; mode?: string;
}

export function BacklogQueue({ jobs, onCancel }: { jobs: Job[]; onCancel: (id: string) => void }) {
  if (!jobs.length) return <div style={{ textAlign:"center", color:"#555570", fontSize:"0.82rem", marginTop:"2rem" }}>Queue empty</div>;
  return (
    <div>
      {jobs.map((j) => {
        const dotColor = j.status === "running" ? "#6C63FF" : j.status === "done" ? "#00FFB2" : "#555570";
        return (
          <div key={j.job_id} style={{ display:"flex", alignItems:"center", gap:"0.6rem",
                                       padding:"0.6rem 0.8rem", background:"#1E1E2E", borderRadius:8, marginBottom:"0.4rem" }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:dotColor, flexShrink:0 }}></div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:"0.78rem", fontWeight:500 }}>{j.tool}</div>
              <div style={{ fontSize:"0.68rem", color:"#555570", fontFamily:"monospace" }}>{j.requester} · {j.mode}</div>
            </div>
            {j.status === "pending" && (
              <button onClick={() => onCancel(j.job_id)}
                style={{ padding:"0.2rem 0.5rem", borderRadius:4, border:"1px solid rgba(255,68,102,0.3)",
                         background:"transparent", color:"#FF4466", cursor:"pointer", fontSize:"0.72rem" }}>✕</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
