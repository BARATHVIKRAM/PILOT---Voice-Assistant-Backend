// /**
//  * ToolStatusCard — live tool invocation display.
//  * FSE-B owns this.
//  */
// import React from "react";

// interface Props {
//   job_id: string; tool: string; status: string;
//   speaker?: string; result?: unknown; latency_ms?: number;
// }

// export function ToolStatusCard({ tool, status, speaker, result, latency_ms }: Props) {
//   const color = { running:"#6C63FF", ok:"#00FFB2", error:"#FF4466", cancelled:"#FF6B35" }[status] ?? "#8888AA";
//   const icon  = { running:"⟳", ok:"✓", error:"✗", cancelled:"⊘" }[status] ?? "?";
//   return (
//     <div style={{ background:"#1E1E2E", border:"1px solid rgba(108,99,255,0.15)", borderRadius:10, padding:"0.75rem 1rem" }}>
//       <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.3rem" }}>
//         <span style={{ color }}>{icon}</span>
//         <span style={{ fontSize:"0.8rem", fontWeight:600 }}>{tool}</span>
//         <span style={{ marginLeft:"auto", fontSize:"0.6rem", color, background:`${color}22`, padding:"1px 6px", borderRadius:20 }}>{status}</span>
//       </div>
//       {speaker && <div style={{ fontSize:"0.7rem", color:"#555570", fontFamily:"monospace" }}>{speaker} {latency_ms ? `· ${latency_ms}ms` : ""}</div>}
//       {result && (
//         <div style={{ marginTop:"0.4rem", padding:"0.3rem 0.5rem", background:"#12121A", borderRadius:6, fontSize:"0.7rem", fontFamily:"monospace", color:"#00FFB2" }}>
//           {JSON.stringify(result).substring(0, 120)}
//         </div>
//       )}
//     </div>
//   );
// }

import React from "react";

interface Props {
  job_id: string;
  tool: string;
  status: string;
  speaker?: string;
  result?: unknown;
  latency_ms?: number;
}

export function ToolStatusCard({
  tool,
  status,
  speaker,
  result,
  latency_ms,
}: Props) {
  const colorMap: Record<string, string> = {
    running: "#6C63FF",
    ok: "#00FFB2",
    error: "#FF4466",
    cancelled: "#FF6B35",
  };

  const iconMap: Record<string, string> = {
    running: "⟳",
    ok: "✓",
    error: "✗",
    cancelled: "⊘",
  };

  const color = colorMap[status] ?? "#8888AA";
  const icon = iconMap[status] ?? "?";

  return (
    <div
      style={{
        background: "#1E1E2E",
        border: "1px solid rgba(108,99,255,0.15)",
        borderRadius: 10,
        padding: "0.75rem 1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.3rem",
        }}
      >
        <span style={{ color }}>{icon}</span>

        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          {tool}
        </span>

        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.6rem",
            color,
            background: `${color}22`,
            padding: "1px 6px",
            borderRadius: 20,
          }}
        >
          {status}
        </span>
      </div>

      {speaker && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "#555570",
            fontFamily: "monospace",
          }}
        >
          {speaker}
          {latency_ms !== undefined ? ` · ${latency_ms}ms` : ""}
        </div>
      )}

      {result !== undefined && result !== null && (
        <div
          style={{
            marginTop: "0.4rem",
            padding: "0.3rem 0.5rem",
            background: "#12121A",
            borderRadius: 6,
            fontSize: "0.7rem",
            fontFamily: "monospace",
            color: "#00FFB2",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {JSON.stringify(result)?.slice(0, 120)}
        </div>
      )}
    </div>
  );
}