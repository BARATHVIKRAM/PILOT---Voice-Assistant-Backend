/**
 * Dashboard shell — Main · PPT · Customer Care
 * Flaw 12: PPT uses upload-only PPTCopilotView (no hardcoded sample)
 * Flaw 14: Session history popup on click
 * Flaw 15: Per-view local transcript state (no cross-page bleed)
 */
import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/SessionStore";
import { PilotWSClient } from "../ws_client";
import { AudioCapture } from "../audio_capture";
import { PPTCopilotView } from "./PPTView";
import { ProfilePage, SettingsPage } from "./ProfilePage";
import { PILOTLogo } from "./PILOTLogo";

const C = {
  amber: "#F5A700", amberDark: "#7C5E00", amberBg: "#FFF8E7",
  bg: "#F7F6F3", surface: "#FFFFFF", border: "#E5E2DA",
  text1: "#1A1A1A", text2: "#555", text3: "#888",
  green: "#22C55E", blue: "#3B82F6", red: "#EF4444",
};

const STATUS_STAGES: Record<string, string[]> = {
  write_file: [
    "Allocating target workspace...",
    "Scanning project directory...",
    "Compiling Python AST structures...",
    "Drafting core logic block...",
    "Verifying syntactic correctness...",
    "Injecting imports...",
    "Finalizing code layout..."
  ],
  write_email: [
    "Searching local user database...",
    "Matching recipient profiles...",
    "Formulating subject header...",
    "Drafting detailed email body...",
    "Formatting responsive template...",
    "Preparing SMTP payload..."
  ],
  send_email: [
    "Opening secure SMTP portal...",
    "Verifying biometric authorization...",
    "Handshaking with mail server...",
    "Transmitting message packets...",
    "Delivered."
  ],
  flight_search: [
    "Accessing travel API...",
    "Filtering origin/destination slots...",
    "Evaluating seat inventories...",
    "Retrieving pricing indices...",
    "Sorting by lowest cost..."
  ],
  flight_book: [
    "Allocating travel passenger seat...",
    "Authorizing payment ledger...",
    "Securing booking reference..."
  ],
  crm_lookup: [
    "Accessing secure CRM schema...",
    "Querying tier levels and metadata...",
    "Compiling profile data..."
  ],
  kb_search: [
    "Searching index document store...",
    "Extracting closest matches...",
    "Parsing search context..."
  ],
  ticket_create: [
    "Opening support ticket schema...",
    "Generating random reference ID...",
    "Committing log to db..."
  ]
};

function LiveTaskStatus({ tool, status }: { tool: string; status: string }) {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    if (status !== "running") return;
    const stages = STATUS_STAGES[tool] || ["Processing background task...", "Running active subtask..."];
    const interval = setInterval(() => {
      setStageIdx(prev => (prev + 1) % stages.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [tool, status]);

  if (status === "running") {
    const stages = STATUS_STAGES[tool] || ["Processing background task...", "Running active subtask..."];
    return (
      <div style={{ fontSize: "0.65rem", color: C.amberDark, fontStyle: "italic", animation: "pulse 1.2s infinite", marginTop: 2 }}>
        ⌛ {stages[stageIdx % stages.length]}
      </div>
    );
  }

  return (
    <div style={{ fontSize: "0.65rem", color: (status === "ok" || status === "success") ? C.green : "#AAA", marginTop: 2 }}>
      {(status === "ok" || status === "success") ? "✓ Task completed successfully" : "Pending execution"}
    </div>
  );
}

/* ── Code / Markdown structured renderer for transcripts ── */
function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Very simple and beautiful syntax highlighting regex/lexer for python, js, html, ts, email
  const highlight = (txt: string, language: string) => {
    if (language && language.toLowerCase() === "email") {
      const lines = txt.split("\n");
      return lines.map((line, lIdx) => {
        const lower = line.toLowerCase();
        if (lower.startsWith("subject:") || lower.startsWith("to:") || lower.startsWith("from:") || lower.startsWith("email:") || lower.startsWith("cc/bcc:")) {
          const match = line.match(/^([^:]+:)(.*)$/);
          if (match) {
            return (
              <div key={lIdx}>
                <span style={{ color: "#f5a700", fontWeight: "bold" }}>{match[1]}</span>
                <span style={{ color: "#00FFB2", fontWeight: "600" }}>{match[2]}</span>
              </div>
            );
          }
        }
        if (line.includes("Main Section Start") || line.includes("----")) {
          return (
            <div key={lIdx} style={{ color: "#FFBF00", fontWeight: "800", letterSpacing: "0.05em", margin: "0.3rem 0" }}>
              {line}
            </div>
          );
        }
        return <div key={lIdx} style={{ color: "#cdd6f4" }}>{line}</div>;
      });
    }

    if (!language || !["python", "py", "javascript", "js", "typescript", "ts", "html"].includes(language.toLowerCase())) {
      return <span>{txt}</span>;
    }

    const lines = txt.split("\n");
    return lines.map((line, lIdx) => {
      // Split line into tokens using a regex for strings, keywords, comments, numbers
      const tokenRegex = /(\/\/.*|\/\*[\s\S]*?\*\/|#.*|"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|`[^`]*`|\b(?:def|class|import|from|return|async|await|const|let|var|function|if|else|for|while|try|except|catch|finally|export|default|interface|type|public|private|new|null|undefined|true|false)\b|\b\d+\b|[{}[\]().,;+\-*/%&|^!=<>:?])/g;
      const parts = line.split(tokenRegex);

      return (
        <div key={lIdx} style={{ minHeight: "1rem" }}>
          {parts.map((part, pIdx) => {
            if (!part) return null;
            if (part.startsWith("//") || part.startsWith("#") || part.startsWith("/*")) {
              return <span key={pIdx} style={{ color: "#6a9955", fontStyle: "italic" }}>{part}</span>;
            }
            if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'")) || (part.startsWith('`') && part.endsWith('`'))) {
              return <span key={pIdx} style={{ color: "#ce9178" }}>{part}</span>;
            }
            const keywords = ["def", "class", "import", "from", "return", "async", "await", "const", "let", "var", "function", "if", "else", "for", "while", "try", "except", "catch", "finally", "export", "default", "interface", "type", "public", "private", "new"];
            if (keywords.includes(part)) {
              return <span key={pIdx} style={{ color: "#569cd6", fontWeight: "bold" }}>{part}</span>;
            }
            if (/^\d+$/.test(part)) {
              return <span key={pIdx} style={{ color: "#b5cea8" }}>{part}</span>;
            }
            const builtins = ["true", "false", "null", "undefined", "print", "console", "log", "self", "this"];
            if (builtins.includes(part)) {
              return <span key={pIdx} style={{ color: "#4fc1ff" }}>{part}</span>;
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </div>
      );
    });
  };

  return (
    <div style={{ position: "relative", margin: "0.8rem 0" }}>
      <pre style={{
        background: "#1e1e2e",
        color: "#cdd6f4",
        padding: "2.5rem 1rem 1rem",
        fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
        borderRadius: 10,
        overflowX: "auto",
        textAlign: "left",
        fontSize: "0.78rem",
        border: "1px solid #313244",
        lineHeight: 1.5,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)"
      }}>
        {lang && (
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            fontSize: "0.62rem",
            fontWeight: 800,
            textTransform: "uppercase",
            color: "#f5a700",
            background: "#252538",
            borderBottom: "1px solid #313244",
            padding: "0.45rem 1rem",
            userSelect: "none",
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <span>🛠️ {lang} code</span>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? C.green : "transparent",
                border: "1px solid rgba(245,167,0,0.3)",
                color: copied ? "#fff" : "#f5a700",
                fontSize: "0.58rem",
                padding: "2px 6px",
                borderRadius: 4,
                cursor: "pointer",
                fontWeight: 600,
                textTransform: "uppercase",
                transition: "all 0.15s ease"
              }}
            >
              {copied ? "Copied! ✓" : "Copy Code"}
            </button>
          </div>
        )}
        <code>{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

function renderTranscriptText(text: string) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const lang = match ? match[1] : "";
      const code = match ? match[2] : part.slice(3, -3);
      
      return <HighlightedCode key={index} code={code} lang={lang} />;
    }

    // Check for inline python function: "def name(...):"
    const pyMatch = part.match(/([\s\S]*?)\b(def\s+\w+\s*\(.*?\)\s*:[\s\S]*)/);
    if (pyMatch) {
      const intro = pyMatch[1];
      const code = pyMatch[2];
      return (
        <span key={index} style={{ display: "inline-block", width: "100%" }}>
          {intro && <span style={{ whiteSpace: "pre-wrap", display: "inline-block", marginBottom: "0.4rem" }}>{intro}</span>}
          <HighlightedCode code={code} lang="python" />
        </span>
      );
    }

    // Check for inline javascript arrow function
    const jsMatch = part.match(/([\s\S]*?)\b((?:const|let|var)\s+\w+\s*=\s*(?:\([^)]*\)|\w+)\s*=>[\s\S]*)/);
    if (jsMatch) {
      const intro = jsMatch[1];
      const code = jsMatch[2];
      return (
        <span key={index} style={{ display: "inline-block", width: "100%" }}>
          {intro && <span style={{ whiteSpace: "pre-wrap", display: "inline-block", marginBottom: "0.4rem" }}>{intro}</span>}
          <HighlightedCode code={code} lang="javascript" />
        </span>
      );
    }

    // Check for inline standard javascript function signature
    const fnMatch = part.match(/([\s\S]*?)\b(function\s+\w*\s*\(.*?\)\s*\{[\s\S]*)/);
    if (fnMatch) {
      const intro = fnMatch[1];
      const code = fnMatch[2];
      return (
        <span key={index} style={{ display: "inline-block", width: "100%" }}>
          {intro && <span style={{ whiteSpace: "pre-wrap", display: "inline-block", marginBottom: "0.4rem" }}>{intro}</span>}
          <HighlightedCode code={code} lang="javascript" />
        </span>
      );
    }
    
    // Standard paragraph with spacing support
    return (
      <span key={index} style={{ whiteSpace: "pre-wrap", display: "inline-block" }}>
        {part}
      </span>
    );
  });
}

interface ParsedFlight {
  airline: string;
  flightCode: string;
  departure: string;
  price: string;
  from: string;
  to: string;
}

function parseFlightsFromText(text: string): ParsedFlight[] | null {
  if (!text) return null;
  // Look for "flights from <Origin> to <Destination>"
  const headerMatch = text.match(/flights\s+from\s+([A-Za-z0-9]+)\s+to\s+([A-Za-z0-9]+)/i);
  const from = headerMatch ? headerMatch[1].toUpperCase() : "";
  const to = headerMatch ? headerMatch[2].toUpperCase() : "";

  const lines = text.split("\n");
  const flights: ParsedFlight[] = [];

  // Match line: e.g. "1. Akasa Air (QP-1374) departing at 14:30 for ₹3600"
  const regex = /^\s*\d+\.\s+([A-Za-z0-9\s.&-]+?)\s*(?:\(([^)]+)\))?\s+departing\s+at\s+([0-9:]+\s*(?:AM|PM)?)\s+for\s+(\S+)/i;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      flights.push({
        airline: match[1].trim(),
        flightCode: match[2] ? match[2].trim() : "",
        departure: match[3].trim(),
        price: match[4].trim(),
        from: from || "BOM",
        to: to || "DEL"
      });
    }
  }

  return flights.length > 0 ? flights : null;
}

export function isFlightRelated(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase();
  const keywords = ["flight", "flights", "airline", "book", "departing", "arrival", "ticket", "airport", "passenger", "trip", "travel", "destination", "origin", "customercare", "bom", "del", "jfk", "lax"];
  return keywords.some(kw => clean.includes(kw)) || parseFlightsFromText(text) !== null;
}

export function isPptRelated(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase();
  const keywords = ["ppt", "slide", "slides", "powerpoint", "presentation", "summarize", "navigate", "goto"];
  return keywords.some(kw => clean.includes(kw));
}

export function isEmailRelated(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase();
  const keywords = ["email", "mail", "draft", "sender", "recipient", "subject", "smtp", "dispatch", "send email", "send mail"];
  return keywords.some(kw => clean.includes(kw));
}

export function isJiraRelated(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase();
  const keywords = ["jira", "issue", "comment on", "transition", "jira-42", "jira-88", "standup", "alex", "dave"];
  return keywords.some(kw => clean.includes(kw));
}

/* ── Sidebar ── */
function Sidebar({ active }: { active: string }) {
  const store = useAppStore();
  return (
    <div style={{ width:228, background:C.bg, borderRight:`1.5px solid ${C.border}`,
                  display:"flex", flexDirection:"column", height:"100vh", flexShrink:0 }}>
      <div style={{ padding:"1rem", borderBottom:`1.5px solid ${C.border}`,
                    display:"flex", alignItems:"center", gap:"0.6rem" }}>
        <PILOTLogo size={36} />
        <div>
          <div style={{ fontWeight:800, fontSize:"0.92rem" }}>PILOT</div>
          <div style={{ fontSize:"0.62rem", color:C.text3 }}>Voice AI OS</div>
        </div>
      </div>
      <nav style={{ flex:1, padding:"0 0.5rem" }}>
        {[{id:"dashboard",icon:"⊞",label:"Main Dashboard"},
          {id:"ppt",icon:"🖥",label:"PPT Copilot"},
          {id:"care",icon:"🎧",label:"Customer Care"},
          {id:"email",icon:"✉️",label:"Email Center"},
          {id:"jira",icon:"📊",label:"JIRA Standup"}].map(n=>(
          <button key={n.id} onClick={()=>store.setPage(n.id as any)}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:"0.6rem",
                     padding:"0.6rem 0.75rem", borderRadius:8, border:"none",
                     background:active===n.id?C.amber:"transparent",
                     color:active===n.id?"#fff":C.text2,
                     fontWeight:active===n.id?600:400, fontSize:"0.85rem",
                     marginBottom:"0.1rem", cursor:"pointer", textAlign:"left" }}>
            <span>{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>
      <div style={{ borderTop:`1.5px solid ${C.border}`, padding:"0.6rem" }}>
        <button onClick={()=>store.setPage("settings" as any)}
          style={{ width:"100%", display:"flex", alignItems:"center", gap:"0.6rem",
                   padding:"0.5rem 0.75rem", borderRadius:8, border:"none",
                   background:"transparent", color:C.text3,
                   fontSize:"0.82rem", cursor:"pointer", marginBottom:"0.1rem" }}>
          ⚙ Settings
        </button>
        <button onClick={()=>store.logout()}
          style={{ width:"100%", display:"flex", alignItems:"center", gap:"0.6rem",
                   padding:"0.5rem 0.75rem", borderRadius:8, border:"none",
                   background:"transparent", color:"#EF4444",
                   fontSize:"0.82rem", cursor:"pointer", marginBottom:"0.1rem" }}>
          ⎋ Sign Out
        </button>
        <div onClick={()=>store.setPage("profile" as any)}
          style={{ display:"flex", alignItems:"center", gap:"0.5rem",
                   padding:"0.5rem 0.75rem", borderRadius:8, cursor:"pointer" }}
          onMouseEnter={e=>(e.currentTarget.style.background=C.amberBg)}
          onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
          <div style={{ width:28, height:28, borderRadius:"50%", background:C.amberDark,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        color:"#fff", fontSize:"0.72rem", fontWeight:700, flexShrink:0 }}>
            {(useAppStore.getState().user?.name||"U").charAt(0).toUpperCase()}
          </div>
          <span style={{ fontSize:"0.82rem", fontWeight:500, color:C.text1,
                         overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {useAppStore.getState().user?.name||"User"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Waveform bars ── */
function WaveBars({ active, level, count=8, color=C.amber }:
  { active:boolean; level:number; count?:number; color?:string }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:"2px" }}>
      {Array.from({length:count},(_,i)=>{
        const seed = (i/count)*Math.PI*2;
        const h = active ? Math.max(3, Math.floor(level*(14+Math.sin(seed+Date.now()/300)*8))) : 3;
        return <div key={i} style={{ width:3, borderRadius:2, background:color,
                                      height:h, transition:"height 0.12s" }}/>;
      })}
    </div>
  );
}

/* ── Live transcript bar ── */
function LiveTranscriptBar({ transcripts, agentStatus, isListening, level, onToggle }:
  { transcripts: any[]; agentStatus: string; isListening: boolean;
    level: number; onToggle: ()=>void }) {
  const last = transcripts[transcripts.length-1];
  return (
    <div style={{ position:"absolute", bottom:0, left:0, right:0,
                  background:"rgba(255,255,255,0.97)",
                  borderTop:`1.5px solid ${C.border}`,
                  backdropFilter:"blur(8px)",
                  padding:"0.75rem 1.25rem",
                  display:"flex", alignItems:"center", gap:"1rem",
                  boxShadow:"0 -4px 20px rgba(0,0,0,0.06)" }}>
      <button onClick={onToggle}
        style={{ width:44, height:44, borderRadius:"50%", flexShrink:0,
                 background: isListening ? C.amber : "#F0EDE8", border:"none",
                 fontSize:"1.1rem", cursor:"pointer",
                 boxShadow: isListening ? `0 0 0 6px rgba(245,167,0,0.2)` : "none",
                 transition:"all 0.2s" }}>
        🎤
      </button>
      <div style={{ flex:1, minWidth:0 }}>
        {last ? (
          <div style={{ animation:"fadeIn 0.3s ease" }}>
            <span style={{ fontSize:"0.7rem", fontWeight:700,
                           color: last.role==="PILOT" ? C.amber : C.amberDark,
                           marginRight:"0.4rem" }}>
              {last.speaker || "You"}:
            </span>
            <span style={{ fontSize:"0.88rem", color:C.text1 }}>{last.text}</span>
          </div>
        ) : (
          <span style={{ fontSize:"0.88rem", color:C.text3 }}>{agentStatus}</span>
        )}
      </div>
      {isListening && <WaveBars active={isListening} level={level}/>}
      {agentStatus.includes("speaking") || agentStatus.includes("Responding") ? (
        <div style={{ display:"flex", alignItems:"center", gap:"0.4rem",
                      padding:"0.3rem 0.75rem", borderRadius:20,
                      background:C.amberBg, fontSize:"0.75rem",
                      color:C.amberDark, fontWeight:600, flexShrink:0 }}>
          <WaveBars active={true} level={0.6} count={5} color={C.amberDark}/>
          PILOT speaking
        </div>
      ) : isListening ? (
        <div style={{ display:"flex", alignItems:"center", gap:"0.35rem", flexShrink:0,
                      fontSize:"0.72rem", color:C.green, fontWeight:600 }}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:C.green,
                         display:"inline-block",animation:"pulse 1.2s infinite" }}/>
          Listening
        </div>
      ) : null}
    </div>
  );
}

/* ── Session hook — unified global shared voice session service ── */
import { sharedVoiceService } from "../shared_voice";

function useSession() {
  const store = useAppStore();
  const [sessionId, setSessionId]     = useState<string|null>(sharedVoiceService.getSessionId());
  const [isListening, setIsListening] = useState(sharedVoiceService.getListening());
  const [agentStatus, setAgentStatus] = useState("Speak or type a command...");
  const [level, setLevel]             = useState(0);
  const [transcripts, setTranscripts] = useState<any[]>([]);

  useEffect(() => {
    // Sync listening status using standard Zustand state tracking
    const listenUnsub = useAppStore.subscribe(
      (s: any) => {
        setIsListening(s.isListeningGlobal);
        setSessionId(sharedVoiceService.getSessionId());
      }
    );
    
    // Sync level meter
    const levelUnsub = sharedVoiceService.registerLevel((lvl) => setLevel(lvl));
    
    // Sync status updates
    const statusUnsub = sharedVoiceService.registerStatus((status) => setAgentStatus(status));
    
    // Sync transcript entries locally
    const transUnsub = sharedVoiceService.registerTranscript((t) => {
      setTranscripts(ts => [...ts.slice(-299), t]);
    });

    return () => {
      listenUnsub();
      levelUnsub();
      statusUnsub();
      transUnsub();
    };
  }, [store]);

  function toggle(usecase?: string) {
    sharedVoiceService.toggle(usecase);
  }

  function stop() {
    sharedVoiceService.stop();
  }

  return { sessionId, isListening, agentStatus, level, toggle, stop, transcripts };
}

/* ── Session History Modal (Flaw 14) ── */
function SessionHistoryModal({ sessionId, onClose, token }:
  { sessionId: string; onClose: ()=>void; token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/sessions/${sessionId}/history`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sessionId, token]);

  const ucIcon: Record<string,string> = { ppt:"🖥", customercare:"🎧", general:"⊞" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}
         onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.5rem",
                    width:560, maxHeight:"80vh", display:"flex", flexDirection:"column",
                    boxShadow:"0 12px 48px rgba(0,0,0,0.18)", overflow:"hidden" }}
           onClick={e => e.stopPropagation()}>
        {/* header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                      marginBottom:"1rem" }}>
          <div>
            <div style={{ fontWeight:800, fontSize:"1rem" }}>
              {ucIcon[data?.session?.usecase||"general"]} Session History
            </div>
            <div style={{ fontSize:"0.72rem", color:C.text3, marginTop:"0.1rem" }}>
              #{data?.session?.display_id || sessionId.slice(0,8)} ·{" "}
              {data?.session?.usecase || "—"} ·{" "}
              <span style={{ padding:"0.15rem 0.45rem", borderRadius:4,
                             background: data?.session?.state === "ENDED" ? "#F0FFF4" : C.amberBg,
                             color: data?.session?.state === "ENDED" ? C.green : C.amberDark,
                             fontSize:"0.68rem", fontWeight:600 }}>
                {data?.session?.state || "—"}
              </span>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", fontSize:"1.3rem", cursor:"pointer", color:C.text3 }}>
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ color:C.text3, fontSize:"0.85rem", textAlign:"center", padding:"2rem" }}>
            Loading…
          </div>
        ) : (
          <div style={{ overflowY:"auto", flex:1 }}>
            {/* AI Session Summary Card */}
            {data?.session?.summary && (
              <div style={{ background:"#FDFBF7", border:`1px solid ${C.amber}`, borderRadius:10, padding:"0.85rem", marginBottom:"1rem" }}>
                <div style={{ fontSize:"0.75rem", fontWeight:800, color:C.amberDark, letterSpacing:"0.05em", marginBottom:"0.25rem" }}>
                  🎙 AI SUMMARY
                </div>
                <div style={{ fontSize:"0.8rem", color:C.text1, lineHeight:1.5 }}>
                  {renderTranscriptText(data.session.summary)}
                </div>
                {data.session.bullets && (() => {
                  try {
                    const blist = JSON.parse(data.session.bullets);
                    if (blist && blist.length > 0) {
                      return (
                        <div style={{ marginTop:"0.6rem", borderTop:`1px dashed ${C.border}`, paddingTop:"0.5rem" }}>
                          <div style={{ fontSize:"0.7rem", fontWeight:700, color:C.text2, marginBottom:"0.3rem" }}>Action Items:</div>
                          <ul style={{ margin:0, paddingLeft:"1rem", fontSize:"0.78rem", color:C.text2, lineHeight:1.45 }}>
                            {blist.map((b: string, idx: number) => (
                              <li key={idx}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    }
                  } catch { /* ignore */ }
                  return null;
                })()}
              </div>
            )}

            {/* Actions summary */}
            {data?.actions?.length > 0 && (
              <div style={{ marginBottom:"1rem" }}>
                <div style={{ fontSize:"0.7rem", fontWeight:700, letterSpacing:"0.08em",
                              color:C.text3, marginBottom:"0.5rem" }}>AGENT ACTIONS</div>
                {data.actions.map((a: any, i: number) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:"0.5rem",
                                        padding:"0.35rem 0.6rem", borderRadius:8,
                                        background:"#F9F8F6", marginBottom:"0.25rem" }}>
                    <span style={{ fontSize:"0.7rem", fontWeight:600, color:C.amberDark,
                                   minWidth:110 }}>{a.tool}</span>
                    <span style={{ fontSize:"0.68rem", padding:"0.1rem 0.4rem", borderRadius:4,
                                   background: a.decision==="ok"||a.decision==="allowed" ? "#F0FFF4" : "#FFF5F5",
                                   color: a.decision==="ok"||a.decision==="allowed" ? C.green : C.red }}>
                      {a.decision}
                    </span>
                    {a.latency_ms && (
                      <span style={{ fontSize:"0.68rem", color:C.text3, marginLeft:"auto" }}>
                        {Math.round(a.latency_ms)}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Transcript */}
            <div style={{ fontSize:"0.7rem", fontWeight:700, letterSpacing:"0.08em",
                          color:C.text3, marginBottom:"0.5rem" }}>TRANSCRIPT</div>
            {data?.transcripts?.length === 0 && (
              <div style={{ color:C.text3, fontSize:"0.82rem" }}>No transcript recorded.</div>
            )}
            {(data?.transcripts || []).map((t: any, i: number) => {
              const isPilot = t.speaker === "PILOT" || t.role === "assistant";
              return (
                <div key={i} style={{ display:"flex", gap:"0.5rem", marginBottom:"0.55rem",
                                       justifyContent: isPilot ? "flex-start" : "flex-end" }}>
                  <div style={{ maxWidth:"80%", padding:"0.5rem 0.75rem", borderRadius:10,
                                background: isPilot ? C.amberBg : "#F0F4FF",
                                fontSize:"0.82rem", lineHeight:1.5,
                                color: isPilot ? C.amberDark : C.text1,
                                border: `1px solid ${isPilot ? C.amber : "#C7D7FF"}` }}>
                    <div style={{ fontSize:"0.62rem", fontWeight:700, marginBottom:"0.15rem",
                                  color: isPilot ? C.amberDark : C.blue }}>
                      {t.speaker || "You"}
                    </div>
                    {renderTranscriptText(t.text)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sessions List (Flaw 14) ── */
function SessionsList({ token }: { token: string }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string|null>(null);

  useEffect(() => {
    fetch("/api/v1/sessions/list", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setSessions(d.sessions || []))
      .catch(() => {});
  }, [token]);

  const ucIcon: Record<string,string> = { ppt:"🖥", customercare:"🎧", general:"⊞" };

  if (sessions.length === 0) return null;

  return (
    <>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                      marginBottom:"0.85rem" }}>
          <h2 style={{ fontSize:"1.1rem", fontWeight:700, display:"flex", alignItems:"center", gap:"0.4rem" }}>
            <span>🕒</span> Recent sessions
          </h2>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.65rem" }}>
          {sessions.slice(0,9).map(s => (
            <div key={s.session_id} onClick={() => setSelected(s.session_id)}
              style={{ background:C.surface, borderRadius:12, padding:"0.9rem",
                       border:`1.5px solid ${C.border}`, cursor:"pointer",
                       transition:"box-shadow 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.07)")}
              onMouseLeave={e => (e.currentTarget.style.boxShadow="none")}>
              <div style={{ display:"flex", alignItems:"center", gap:"0.45rem", marginBottom:"0.45rem" }}>
                <span style={{ fontSize:"1rem" }}>{ucIcon[s.usecase] || "📌"}</span>
                <span style={{ fontSize:"0.72rem", fontWeight:700, color:C.text1 }}>
                  #{s.display_id}
                </span>
                <span style={{ marginLeft:"auto", fontSize:"0.62rem", padding:"0.1rem 0.4rem",
                               borderRadius:4, fontWeight:600,
                               background: s.state==="ENDED" ? "#F0FFF4" : C.amberBg,
                               color: s.state==="ENDED" ? C.green : C.amberDark }}>
                  {s.state}
                </span>
              </div>
              <div style={{ fontSize:"0.72rem", color:C.text2, marginBottom:"0.2rem" }}>
                {s.usecase}
              </div>
              <div style={{ fontSize:"0.65rem", color:C.text3 }}>
                {new Date(s.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <SessionHistoryModal
          sessionId={selected}
          token={token}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

/* ── MAIN DASHBOARD ── */
function MainDashboard() {
  const store = useAppStore();
  const sess  = useSession();
  const ts    = sess.transcripts;   // Flaw 15: local to this view's session
  const tc    = store.toolCards;

  const generalTranscripts = ts.filter(t => !isFlightRelated(t.text) && !isPptRelated(t.text));

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      <div style={{ flex:1, overflow:"auto", padding:"2rem 2.5rem 6rem" }}>
        {/* header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem" }}>
          <div>
            <h1 style={{ fontSize:"1.9rem", fontWeight:800, letterSpacing:"-0.02em" }}>Welcome, {store.user?.name || "there"}</h1>
            <p style={{ color:C.text3, fontSize:"0.85rem" }}>Live voice processing and agent orchestration.</p>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"0.65rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"0.4rem",
                          padding:"0.45rem 0.9rem", background:"#F0FFF4", borderRadius:10,
                          border:`1.5px solid ${C.green}`, fontSize:"0.78rem",
                          fontWeight:700, color:C.green, cursor:"pointer",
                          userSelect:"none" as const }}>
              🔐 ✓ Level 2 Access
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"0.5rem",
                          padding:"0.5rem 1rem", background:C.surface, borderRadius:10,
                          border:`1.5px solid ${C.border}`, fontSize:"0.8rem", fontWeight:600 }}>
              <span style={{ width:8,height:8,borderRadius:"50%", display:"inline-block",
                             background:sess.isListening ? C.green : C.border }}/>
              {sess.isListening ? "Live Mode" : "Offline"}
              <WaveBars active={sess.isListening} level={sess.level} count={5}/>
            </div>
          </div>
        </div>

        {/* Top Layout Grid: Left (Transcript Section) & Right (Tools & Queue Stacked) */}
        <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1.2fr", gap: "1.25rem", marginBottom: "1.75rem", alignItems: "stretch", height: "auto", maxHeight: "460px" }}>
          {/* Transcript section */}
          <div style={{ background: C.surface, borderRadius: 14, padding: "1.25rem",
                        border: `1.5px solid ${C.border}`, overflow: "hidden", display: "flex", flexDirection: "column", height: "auto", maxHeight: "460px" }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>📋</span> Transcript section
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {generalTranscripts.length===0
                ? <div style={{ color:C.text3, fontSize:"0.78rem" }}>Waiting for speech…</div>
                : generalTranscripts.slice(-8).map((t,i)=>{
                  const isPilot = t.speaker==="PILOT";
                  const flightsData = isPilot ? parseFlightsFromText(t.text) : null;
                  return (
                    <div key={i} style={{ marginBottom:"0.5rem", animation:"fadeIn 0.3s ease" }}>
                      <div style={{ fontSize:"0.68rem", fontWeight:700,
                                    color: isPilot ? C.amber : C.amberDark,
                                    marginBottom:"0.1rem" }}>
                        {t.speaker||"You"}
                      </div>
                      <div style={{ background: isPilot ? C.amberBg : "#F9F8F6",
                                    borderRadius:8, padding:"0.4rem 0.6rem",
                                    fontSize:"0.8rem", lineHeight:1.5,
                                    color: isPilot ? C.amberDark : C.text1 }}>
                        {flightsData ? (
                          <div>
                            <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                              Found {flightsData.length} flights from {flightsData[0].from} to {flightsData[0].to}:
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                              {flightsData.map((f, idx) => (
                                <div key={idx} style={{
                                  background: idx === 0 ? "#FFFDF5" : "#FDFDFD",
                                  border: idx === 0 ? `1px solid ${C.amber}` : `1px solid ${C.border}`,
                                  borderRadius: 8,
                                  padding: "0.5rem 0.6rem",
                                  boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.3rem"
                                }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                                      <span style={{ fontSize: "0.8rem" }}>✈️</span>
                                      <span style={{ fontWeight: 700, color: C.text1, fontSize: "0.74rem" }}>{f.airline}</span>
                                    </div>
                                    <span style={{ fontSize: "0.78rem", fontWeight: 800, color: C.amberDark }}>{f.price}</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.68rem", color: C.text2 }}>
                                    <div>{f.from} → {f.to}</div>
                                    <div>{f.departure}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          renderTranscriptText(t.text)
                        )}
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>

          {/* Right Stack: Tools & Queue stacked on top of each other */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", height: "auto", maxHeight: "460px" }}>
            {/* Tools */}
            <div style={{ background: C.surface, borderRadius: 14, padding: "1.25rem", border: `1.5px solid ${C.border}`, display: "flex", flexDirection: "column", flex: "0 0 auto" }}>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>✦</span> Tools
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {([
                  {name:"PPT Copilot", icon:"🖥", page:"ppt"},
                  {name:"Customer Care", icon:"🎧", page:"care"},
                ] as const).map(t=>(
                  <div key={t.name}
                       onClick={()=>store.setPage(t.page as any)}
                       style={{ display:"flex", alignItems:"center", gap:"0.5rem",
                                padding:"0.55rem 0.7rem", borderRadius:10,
                                background:"#F9F8F6", border:`1.5px solid ${C.border}`,
                                cursor:"pointer", transition:"all 0.15s" }}
                       onMouseEnter={e=>(e.currentTarget.style.background=C.amberBg,
                                         e.currentTarget.style.borderColor=C.amber)}
                       onMouseLeave={e=>(e.currentTarget.style.background="#F9F8F6",
                                         e.currentTarget.style.borderColor=C.border)}>
                    <span style={{ fontSize:"1rem" }}>{t.icon}</span>
                    <span style={{ flex:1, fontSize:"0.82rem", fontWeight:600 }}>{t.name}</span>
                    <span style={{ fontSize:"0.7rem", color:C.text3 }}>→</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Queue */}
            <div style={{ background: C.surface, borderRadius: 14, padding: "1.25rem", border: `1.5px solid ${C.border}`, display: "flex", flexDirection: "column", flex: "1 1 auto", overflow: "hidden" }}>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>⊙</span> Queue
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {tc.length===0
                  ? <div style={{ color:C.text3, fontSize:"0.78rem" }}>No jobs yet</div>
                  : tc.map((c,i)=>(
                    <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:"0.45rem", marginBottom:"0.55rem" }}>
                      <div style={{ width:14,height:14,borderRadius:"50%",flexShrink:0,marginTop:2,
                                    background:(c.status==="ok" || c.status==="success")?C.green:c.status==="running"?C.amber:C.border,
                                    display:"flex",alignItems:"center",justifyContent:"center",
                                    fontSize:"0.5rem",color:"#fff" }}>
                        {(c.status==="ok" || c.status==="success")?"✓":c.status==="running"?"●":"○"}
                      </div>
                      <div>
                        <div style={{ fontSize:"0.78rem", fontWeight:600 }}>{c.tool}</div>
                        <LiveTaskStatus tool={c.tool} status={c.status} />
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>


        {/* Recent Sessions card spanning full width below */}
        {store.token && (
          <div style={{ background: C.surface, borderRadius: 14, padding: "1.5rem", border: `1.5px solid ${C.border}` }}>
            <SessionsList token={store.token}/>
          </div>
        )}
      </div>

      <LiveTranscriptBar
        transcripts={generalTranscripts} agentStatus={sess.agentStatus}
        isListening={sess.isListening} level={sess.level}
        onToggle={() => sess.toggle("general")}
      />
    </div>
  );
}

/* ── PPT PAGE (Flaw 12: upload-only, no sample iframe) ── */
function PPTPageView() {
  const sess = useSession();
  const pptTranscripts = sess.transcripts.filter(t => isPptRelated(t.text));

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      <PPTCopilotView
        sessionId={sess.sessionId}
        isListening={sess.isListening}
        agentStatus={sess.agentStatus}
        onToggleMic={() => sess.toggle("ppt")}
      />
      <LiveTranscriptBar
        transcripts={pptTranscripts} agentStatus={sess.agentStatus}
        isListening={sess.isListening} level={sess.level}
        onToggle={() => sess.toggle("ppt")}
      />
    </div>
  );
}

/* ── CUSTOMER CARE VIEW ── */
function CustomerCareView() {
  const sess    = useSession();
  const store   = useAppStore();
  const ts      = sess.transcripts;
  const [input, setInput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [from, setFrom]   = useState("");
  const [to, setTo]       = useState("");
  const [date, setDate]   = useState(""); // used in flight search hint text
  const endRef = useRef<HTMLDivElement>(null);

  const flightTranscripts = ts.filter(t => isFlightRelated(t.text));

  useEffect(()=>{
    const t = setInterval(()=>setElapsed(e=>e+1), 1000);
    return ()=>clearInterval(t);
  },[]);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); }, [flightTranscripts.length]);

  const mm = String(Math.floor(elapsed/60)).padStart(2,"0");
  const ss = String(elapsed%60).padStart(2,"0");

  // Update form inputs dynamically when a voice search is executed in the background
  const lastFlightCall = store.toolCards.slice().reverse().find(c => c.tool === "flight_search");
  useEffect(() => {
    if (lastFlightCall?.result) {
      const res = lastFlightCall.result as any;
      if (res.origin) setFrom(res.origin);
      if (res.destination) setTo(res.destination);
      if (res.date) setDate(res.date);
    }
  }, [lastFlightCall]);

  // Sync manually typed inputs to Zustand global state and server socket so the voice assistant can access them dynamically
  // We decouple the state function reference from dependencies to prevent infinite re-rendering loops
  useEffect(() => {
    useAppStore.getState().setTypedFlightContext(from, to, date);
    // Send immediate context state over websocket events connection
    sharedVoiceService.sendPayload({
      type: "typed_flight_context",
      origin: from,
      destination: to,
      date: date
    });
  }, [from, to, date]);

  // Real-time flights from last flight_search tool result
  const flightCard = store.toolCards.slice().reverse().find(c => c.tool === "flight_search");
  const rawFlights = flightCard?.result ? ((flightCard.result as any).flights || (flightCard.result as any).results || []) : [];
  
  const flights: {airline:string;price:string;dep:string;arr:string;from:string;to:string;id:string}[] =
    rawFlights.map((f:any, i:number) => {
      // Parse price safely
      let priceVal = f.price || "₹4200";
      if (typeof priceVal === "number") {
        priceVal = `₹${priceVal}`;
      }
      return {
        id: f.id || f.flight || `FL${i}`,
        airline: f.airline || f.operator || "Airline",
        price: priceVal,
        dep: f.departure || f.dep || "09:00",
        arr: f.arrival || f.arr || "11:30",
        from: f.origin || from || "BOM",
        to: f.destination || to || "DEL",
      };
    });

  // Sort flights in ascending order by price
  const sortedFlights = [...flights].sort((a, b) => {
    const numA = parseInt(a.price.replace(/[^\d]/g, "")) || 0;
    const numB = parseInt(b.price.replace(/[^\d]/g, "")) || 0;
    return numA - numB;
  });

  // Real-time task queue from store.toolCards (care tools only)
  const careTools = ["crm_lookup","kb_search","ticket_create","ticket_update","ticket_close","flight_search","flight_book"];
  const liveTasks = store.toolCards.filter(c => careTools.includes(c.tool));

  const toolLabel: Record<string,string> = {
    crm_lookup:"Verify Customer Identity", kb_search:"Search Knowledge Base",
    ticket_create:"Create Support Ticket", ticket_update:"Update Ticket",
    ticket_close:"Close Ticket", flight_search:"Search Flights",
    flight_book:"Book & Issue Ticket",
  };

  // Status timeline derived from live tool activity
  const now = new Date();
  const fmt = (d:Date) => d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const timeline = [
    {l:"Session Connected", t: fmt(new Date(now.getTime() - elapsed*1000)), done:true, active:false},
    ...liveTasks.map(c => ({
      l: toolLabel[c.tool] || c.tool,
      t: c.status === "ok" ? "Done" : c.status === "running" ? "In progress…" : "Pending",
      done: c.status === "ok",
      active: c.status === "running",
    })),
  ];

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      {/* header */}
      <div style={{ padding:"0.85rem 1.5rem", background:C.surface,
                    borderBottom:`1.5px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <h2 style={{ fontWeight:800, fontSize:"1rem" }}>Active Session: Flight Booking</h2>
            <p style={{ fontSize:"0.75rem", color:C.text3 }}>Connecting with user ID: 894-3B-ZULU</p>
          </div>
          <div style={{ display:"flex", gap:"0.75rem", alignItems:"center" }}>
            <button onClick={()=>sess.toggle("customercare")}
              style={{ display:"flex", alignItems:"center", gap:"0.4rem",
                       padding:"0.35rem 0.8rem", borderRadius:20,
                       background: sess.isListening ? C.amberBg : "#F0EDE8",
                       border:`1.5px solid ${sess.isListening ? C.amber : C.border}`,
                       fontSize:"0.75rem", color:C.amberDark, fontWeight:600, cursor:"pointer" }}>
              <span style={{ width:7,height:7,borderRadius:"50%",background:C.amber,
                             display:"inline-block" }}/>
              {sess.isListening ? "Live Call" : "Start Call"}
            </button>
            <span style={{ fontSize:"0.8rem", color:C.text2, fontFamily:"monospace" }}>{mm}:{ss}</span>
          </div>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* flight search panel */}
        <div style={{ width:210, background:"#F9F8F6", borderRight:`1.5px solid ${C.border}`,
                      padding:"0.85rem", overflowY:"auto", flexShrink:0, display:"flex",
                      flexDirection:"column", gap:"0.35rem" }}>
          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, marginBottom:"0.25rem" }}>FLIGHT SEARCH</div>
          {/* From / To / Date inputs */}
          {[
            {icon:"🛫", placeholder:"From (e.g. JFK)", val:from, set:setFrom},
            {icon:"🛬", placeholder:"To (e.g. LAX)",   val:to,   set:setTo},
            {icon:"📅", placeholder:"Date (e.g. 2026-07-01)", val:date, set:setDate},
          ].map(f=>(
            <div key={f.placeholder} style={{ display:"flex", alignItems:"center", gap:"0.35rem",
                                              background:"#fff", borderRadius:8,
                                              border:`1.5px solid ${C.border}`, padding:"0.3rem 0.5rem" }}>
              <span style={{ fontSize:"0.85rem" }}>{f.icon}</span>
              <input value={f.val} onChange={e=>f.set(e.target.value)}
                placeholder={f.placeholder}
                style={{ flex:1, border:"none", outline:"none", fontSize:"0.72rem",
                         background:"transparent", color:C.text1 }}/>
            </div>
          ))}
          <div style={{ fontSize:"0.66rem", color:C.text3, marginTop:"0.1rem" }}>
            Say "search flights from {from||"…"} to {to||"…"}" or type above
          </div>
        </div>

        {/* chat */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"0.65rem",
                        padding:"0.65rem 1rem", background:"#fff",
                        borderBottom:`1.5px solid ${C.border}`, flexShrink:0 }}>
            <div style={{ width:32,height:32,borderRadius:"50%",background:"#E5E7EB",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem" }}>🧑</div>
            <div>
              <div style={{ fontWeight:600, fontSize:"0.85rem" }}>Customer Care Agent</div>
              <div style={{ fontSize:"0.68rem", color:C.text3 }}>
                {sess.isListening ? "Speaking..." : "Connected"}
              </div>
            </div>
            {sess.isListening && (
              <div style={{ marginLeft:"auto" }}>
                <WaveBars active={true} level={sess.level} count={5}/>
              </div>
            )}
          </div>

          {/* messages = session-scoped transcripts */}
          <div style={{ flex:1, overflowY:"auto", padding:"0.85rem" }}>
            {flightTranscripts.length===0 && (
              <div style={{ textAlign:"center", color:C.text3, fontSize:"0.82rem", marginTop:"2rem" }}>
                Start a session and speak to see the live conversation.
              </div>
            )}
            {flightTranscripts.map((t,i)=>{
              const isAgent = t.speaker==="PILOT" || t.role==="PILOT";
              const flightsData = isAgent ? parseFlightsFromText(t.text) : null;
              return (
                <div key={i} style={{ display:"flex", justifyContent:isAgent?"flex-start":"flex-end",
                                       marginBottom:"0.7rem", animation:"fadeIn 0.3s ease" }}>
                  {isAgent&&(
                    <div style={{ width:28,height:28,borderRadius:"50%",background:C.amber,
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  marginRight:"0.4rem",flexShrink:0,fontSize:"0.75rem" }}>🤖</div>
                  )}
                  <div style={{ maxWidth:"68%", padding:"0.65rem 0.85rem",
                                background:isAgent?"#fff":C.blue,
                                color:isAgent?C.text1:"#fff",
                                borderRadius:isAgent?"12px 12px 12px 3px":"12px 12px 3px 12px",
                                fontSize:"0.85rem", lineHeight:1.55,
                                border:isAgent?`1.5px solid ${C.border}`:"none",
                                boxShadow:isAgent?"0 2px 8px rgba(0,0,0,0.04)":"none" }}>
                    {flightsData ? (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                          Found {flightsData.length} flights from {flightsData[0].from} to {flightsData[0].to}:
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                          {flightsData.map((f, idx) => (
                            <div key={idx} style={{
                              background: idx === 0 ? "#FFFDF5" : "#FDFDFD",
                              border: idx === 0 ? `1px solid ${C.amber}` : `1px solid ${C.border}`,
                              borderRadius: 10,
                              padding: "0.6rem 0.8rem",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.4rem",
                              position: "relative"
                            }}>
                              {idx === 0 && (
                                <div style={{
                                  position: "absolute",
                                  top: -8,
                                  right: 8,
                                  background: C.amber,
                                  color: "#fff",
                                  fontSize: "0.55rem",
                                  fontWeight: 800,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  textTransform: "uppercase"
                                }}>
                                  Best Value
                                </div>
                              )}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                  <span style={{ fontSize: "0.9rem" }}>✈️</span>
                                  <span style={{ fontWeight: 700, color: C.text1, fontSize: "0.78rem" }}>{f.airline}</span>
                                  {f.flightCode && (
                                    <span style={{ fontSize: "0.65rem", color: C.text3, fontFamily: "monospace", background: "#F0EDE8", padding: "1px 4px", borderRadius: 3 }}>
                                      {f.flightCode}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: "0.85rem", fontWeight: 800, color: C.amberDark }}>{f.price}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem", color: C.text2 }}>
                                <div>{f.from} → {f.to}</div>
                                <div style={{ fontWeight: 500 }}>Dep: <span style={{ fontWeight: 600, color: C.text1 }}>{f.departure}</span></div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.1rem", gap: "0.4rem" }}>
                                {/* <button 
                                  onClick={() => {
                                    sharedVoiceService.sendPayload({
                                      type: "chat_message",
                                      text: `Please book flight ${f.flightCode || f.airline} from ${f.from} to ${f.to} for me.`
                                    });
                                  }}
                                  style={{
                                    padding: "0.25rem 0.6rem",
                                    background: idx === 0 ? C.amber : "#F0EDE8",
                                    color: idx === 0 ? "#fff" : C.text1,
                                    border: "none",
                                    borderRadius: 5,
                                    fontSize: "0.68rem",
                                    fontWeight: 600,
                                    cursor: "pointer"
                                  }}
                                >
                                  Book Flight
                                </button> */}
                                <a 
                                  href={`https://www.google.com/travel/flights?q=Flights%20from%20${f.from}%20to%20${f.to}%20on%20${date || "2026-07-01"}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    padding: "0.25rem 0.6rem",
                                    background: "rgba(108,99,255,0.1)",
                                    color: "#6C63FF",
                                    textDecoration: "none",
                                    borderRadius: 5,
                                    fontSize: "0.68rem",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center"
                                  }}
                                >
                                  View on Google Flights ↗
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      renderTranscriptText(t.text)
                    )}
                  </div>
                  {!isAgent&&(
                    <div style={{ width:28,height:28,borderRadius:"50%",background:C.amberDark,
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  marginLeft:"0.4rem",flexShrink:0,color:"#fff",fontSize:"0.68rem",fontWeight:700 }}>
                      {(t.speaker||"U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef}/>
          </div>

          {/* text input */}
          <div style={{ display:"flex", gap:"0.6rem", padding:"0.65rem 0.85rem",
                        background:"#fff", borderTop:`1.5px solid ${C.border}`, flexShrink:0,
                        alignItems:"flex-end" }}>
            <button style={{ width:28,height:28,borderRadius:7,background:"#F0EDE8",
                             border:`1.5px solid ${C.border}`,fontSize:"0.9rem",flexShrink:0 }}>+</button>
            <input value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{
                if(e.key==="Enter"&&input.trim()){
                  // local only — doesn't pollute other views
                  setInput("");
                }
              }}
              style={{ flex:1, padding:"0.55rem 0.8rem", borderRadius:10,
                       border:`1.5px solid ${C.border}`, fontSize:"0.85rem",
                       background:"#F9F8F6", outline:"none" }}
              placeholder="Type a message or command override..."/>
            <button style={{ padding:"0.55rem 1rem", borderRadius:10, background:C.amberDark,
                             border:"none", color:"#fff", fontWeight:600, fontSize:"0.85rem" }}>
              ▶ Send
            </button>
          </div>
        </div>

        {/* task queue */}
        <div style={{ width:210, background:"#fff", borderLeft:`1.5px solid ${C.border}`,
                      padding:"0.85rem", overflowY:"auto", flexShrink:0 }}>
          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, marginBottom:"0.6rem" }}>TASK QUEUE</div>
          {liveTasks.length === 0
            ? <div style={{ fontSize:"0.72rem", color:C.text3 }}>No tasks yet. Start a call.</div>
            : liveTasks.map((t,i)=>(
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"stretch",
                                     padding:"0.55rem", borderRadius:8, marginBottom:"0.3rem",
                                     background:t.status==="running"?C.amberBg:"transparent",
                                     border:`1.5px solid ${t.status==="running"?C.amber:C.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:"0.45rem" }}>
                  <div style={{ width:16,height:16,borderRadius:"50%",flexShrink:0,
                                background:(t.status==="ok" || t.status==="success")?C.green:t.status==="running"?C.amber:"#F0EDE8",
                                display:"flex",alignItems:"center",justifyContent:"center",
                                fontSize:"0.55rem",color:"#fff" }}>
                    {(t.status==="ok" || t.status==="success")?"✓":t.status==="running"?"●":"○"}
                  </div>
                  <span style={{ fontSize:"0.74rem", fontWeight:600,
                                 textDecoration:(t.status==="ok" || t.status==="success")?"line-through":"none",
                                 color:(t.status==="ok" || t.status==="success")?"#AAA":C.text1 }}>
                    {toolLabel[t.tool] || t.tool}
                  </span>
                </div>
                <div style={{ paddingLeft: 20 }}>
                  <LiveTaskStatus tool={t.tool} status={t.status} />
                </div>
              </div>
            ))
          }

          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, margin:"1rem 0 0.6rem" }}>STATUS TIMELINE</div>
          {timeline.map((s,i)=>(
            <div key={i} style={{ display:"flex", gap:"0.45rem", marginBottom:"0.65rem" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ width:11,height:11,borderRadius:"50%",flexShrink:0,
                              background:s.done?C.green:s.active?C.amber:C.border }}/>
                {i<timeline.length-1&&<div style={{ width:2,height:18,background:C.border }}/>}
              </div>
              <div>
                <div style={{ fontSize:"0.75rem", fontWeight:600,
                              color:s.active?C.text1:C.text3 }}>{s.l}</div>
                <div style={{ fontSize:"0.65rem", color:s.active?C.amber:"#AAA" }}>{s.t}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <LiveTranscriptBar
        transcripts={flightTranscripts} agentStatus={sess.agentStatus}
        isListening={sess.isListening} level={sess.level}
        onToggle={() => sess.toggle("customercare")}
      />
    </div>
  );
}

/* ── Confirm overlay ── */
function ConfirmOverlay() {
  const store = useAppStore();
  if (!store.confirmPrompt) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",
                  display:"flex",alignItems:"center",justifyContent:"center",zIndex:200 }}>
      <div style={{ background:"#fff",borderRadius:16,padding:"1.75rem",maxWidth:380,width:"90%",
                    boxShadow:"0 8px 40px rgba(0,0,0,0.12)" }}>
        <div style={{ fontSize:"1rem",fontWeight:700,marginBottom:"0.4rem" }}>⚠ Confirm Action</div>
        <p style={{ color:C.text2, fontSize:"0.88rem", marginBottom:"1.25rem" }}>
          {store.confirmPrompt.message}
        </p>
        <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
          <button onClick={()=>store.setConfirm(null)}
            style={{ padding:"0.55rem 1.1rem",borderRadius:8,border:`1.5px solid ${C.border}`,
                     background:"#fff",cursor:"pointer",fontSize:"0.85rem" }}>Cancel</button>
          <button onClick={()=>store.setConfirm(null)}
            style={{ padding:"0.55rem 1.1rem",borderRadius:8,border:"none",
                     background:C.amberDark,color:"#fff",fontWeight:600,
                     fontSize:"0.85rem",cursor:"pointer" }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard shell — Keep-Alive Tab Router pattern to prevent session unmount resets ── */
export function Dashboard() {
  const page = useAppStore(s=>s.page) as string;
  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:C.bg }}>
      <Sidebar active={page==="ppt"?"ppt":page==="care"?"care":page==="email"?"email":page==="jira"?"jira":"dashboard"}/>
      
      {/* PPT Copilot View */}
      <div style={{ display: page === "ppt" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <PPTPageView/>
      </div>
      
      {/* Customer Care View */}
      <div style={{ display: page === "care" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <CustomerCareView/>
      </div>

      {/* Email Center View */}
      <div style={{ display: page === "email" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <EmailPageView/>
      </div>

      {/* JIRA Standup View */}
      <div style={{ display: page === "jira" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <JiraPageView/>
      </div>
      
      {/* Profile page */}
      <div style={{ display: page === "profile" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <ProfilePage/>
      </div>
      
      {/* Settings Page */}
      <div style={{ display: page === "settings" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <SettingsPage/>
      </div>
      
      {/* Main Dashboard View */}
      <div style={{ display: (!["ppt", "care", "email", "jira", "profile", "settings"].includes(page)) ? "flex" : "none", flex: 1, flexDirection: "column" }}>
        <MainDashboard/>
      </div>
      
      <ConfirmOverlay/>
    </div>
  );
}

/* ── EMAIL CENTER PAGE ── */
export function EmailPageView() {
  const sess    = useSession();
  const store   = useAppStore();
  const ts      = sess.transcripts;
  const [input, setInput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  // Form states for left composition form
  const [formFrom, setFormFrom] = useState(store.user?.email || "pagupta@griddynamics.com");
  const [formTo, setFormTo] = useState("");
  const [formCcBcc, setFormCcBcc] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);

  useEffect(()=>{
    const t = setInterval(()=>setElapsed(e=>e+1), 1000);
    return ()=>clearInterval(t);
  },[]);

  // Sync manually typed inputs to Zustand global state / websocket so backend LLM can access them
  useEffect(() => {
    sharedVoiceService.sendPayload({
      type: "typed_email_context",
      from: formFrom,
      to: formTo,
      cc_bcc: formCcBcc,
      subject: formSubject
    });
  }, [formFrom, formTo, formCcBcc, formSubject]);

  const emailTranscripts = ts.filter(t => isEmailRelated(t.text));

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); }, [emailTranscripts.length]);

  const mm = String(Math.floor(elapsed/60)).padStart(2,"0");
  const ss = String(elapsed%60).padStart(2,"0");

  // Filter tool cards for email activities
  const emailTools = ["write_email", "send_email"];
  const liveTasks = store.toolCards.filter(c => emailTools.includes(c.tool));

  // Find the last completed draft card
  const lastDraftCard = store.toolCards.slice().reverse().find(c => c.tool === "write_email" && c.status === "ok");
  const lastDraftResult = lastDraftCard?.result as any;
  const currentDraft = lastDraftResult?.email_draft || "";
  const recipientName = lastDraftResult?.recipient_name || "";
  const recipientEmail = lastDraftResult?.recipient_email || "";

  const toolLabel: Record<string,string> = {
    write_email: "Draft Email Template",
    send_email: "Send Email Real-time",
  };

  const now = new Date();
  const fmt = (d:Date) => d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const timeline = [
    {l:"Email Client connected", t: fmt(new Date(now.getTime() - elapsed*1000)), done:true, active:false},
    ...liveTasks.map(c => ({
      l: toolLabel[c.tool] || c.tool,
      t: c.status === "ok" ? "Done" : c.status === "running" ? "In progress…" : "Pending",
      done: c.status === "ok",
      active: c.status === "running",
    })),
  ];

  async function handleDraftEmail() {
    if (!formTo.trim() || !formSubject.trim() || !formBody.trim()) {
      alert("Please fill out To, Subject, and Body fields.");
      return;
    }
    setIsDrafting(true);
    try {
      const response = await fetch("/api/v1/sessions/draft-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${store.token}`
        },
        body: JSON.stringify({
          session_id: sess.sessionId || "default",
          from_email: formFrom,
          to_email: formTo,
          cc_bcc: formCcBcc,
          subject: formSubject,
          body: formBody
        })
      });
      const data = await response.json();
      if (data.status === "ok") {
        setFormBody(""); // Clear form body on success
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsDrafting(false);
    }
  }

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      {/* header */}
      <div style={{ padding:"0.85rem 1.5rem", background:C.surface,
                    borderBottom:`1.5px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <h2 style={{ fontWeight:800, fontSize:"1rem" }}>Active Session: Email Center</h2>
            <p style={{ fontSize:"0.75rem", color:C.text3 }}>Draft and dispatch authorized SMTP messages via voice biometrics.</p>
          </div>
          <div style={{ display:"flex", gap:"0.75rem", alignItems:"center" }}>
            <button onClick={()=>sess.toggle("email")}
              style={{ display:"flex", alignItems:"center", gap:"0.4rem",
                       padding:"0.35rem 0.8rem", borderRadius:20,
                       background: sess.isListening ? C.amberBg : "#F0EDE8",
                       border:`1.5px solid ${sess.isListening ? C.amber : C.border}`,
                       fontSize:"0.75rem", color:C.amberDark, fontWeight:600, cursor:"pointer" }}>
              <span style={{ width:7,height:7,borderRadius:"50%",background:C.amber,
                             display:"inline-block" }}/>
              {sess.isListening ? "Live Call" : "Start Call"}
            </button>
            <span style={{ fontSize:"0.8rem", color:C.text2, fontFamily:"monospace" }}>{mm}:{ss}</span>
          </div>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Left Side - Email Composition Form */}
        <div style={{ width:280, background:"#F9F8F6", borderRight:`1.5px solid ${C.border}`,
                      padding:"1rem", overflowY:"auto", flexShrink:0, display:"flex",
                      flexDirection:"column", gap:"0.75rem" }}>
          <div style={{ fontSize:"0.72rem", fontWeight:800, letterSpacing:"0.08em",
                        color:C.text2, marginBottom:"0.25rem", borderBottom:`1px solid ${C.border}`, paddingBottom:"0.35rem" }}>
            EMAIL COMPOSITION FORM
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <div>
              <label style={{ fontSize: "0.68rem", fontWeight: 700, color: C.text2, display: "block", marginBottom: 3 }}>FROM:</label>
              <input value={formFrom} readOnly disabled
                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: `1px solid ${C.border}`, background: "#EFECE8", color: C.text3, fontSize: "0.74rem", outline: "none", cursor: "not-allowed" }}/>
            </div>
            
            <div>
              <label style={{ fontSize: "0.68rem", fontWeight: 700, color: C.text2, display: "block", marginBottom: 3 }}>TO:</label>
              <input value={formTo} onChange={e=>setFormTo(e.target.value)} placeholder="recipient@domain.com"
                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.text1, fontSize: "0.74rem", outline: "none" }}/>
            </div>

            <div>
              <label style={{ fontSize: "0.68rem", fontWeight: 700, color: C.text2, display: "block", marginBottom: 3 }}>CC/BCC:</label>
              <input value={formCcBcc} onChange={e=>setFormCcBcc(e.target.value)} placeholder="info@pilot.ai"
                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.text1, fontSize: "0.74rem", outline: "none" }}/>
            </div>

            <div>
              <label style={{ fontSize: "0.68rem", fontWeight: 700, color: C.text2, display: "block", marginBottom: 3 }}>SUBJECT:</label>
              <input value={formSubject} onChange={e=>setFormSubject(e.target.value)} placeholder="Enter email subject"
                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.text1, fontSize: "0.74rem", outline: "none" }}/>
            </div>
          </div>
        </div>

        {/* chat */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"0.65rem",
                        padding:"0.65rem 1rem", background:"#fff",
                        borderBottom:`1.5px solid ${C.border}`, flexShrink:0 }}>
            <div style={{ width:32,height:32,borderRadius:"50%",background:"#E5E7EB",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem" }}>🧑</div>
            <div>
              <div style={{ fontWeight:600, fontSize:"0.85rem" }}>Email Agent Specialist</div>
              <div style={{ fontSize:"0.68rem", color:C.text3 }}>
                {sess.isListening ? "Speaking..." : "Connected"}
              </div>
            </div>
            {sess.isListening && (
              <div style={{ marginLeft:"auto" }}>
                <WaveBars active={true} level={sess.level} count={5}/>
              </div>
            )}
          </div>

          {/* messages = session-scoped transcripts */}
          <div style={{ flex:1, overflowY:"auto", padding:"0.85rem" }}>
            {emailTranscripts.length===0 && (
              <div style={{ textAlign:"center", color:C.text3, fontSize:"0.82rem", marginTop:"2rem" }}>
                Start a session and speak to see the live conversation.
              </div>
            )}
            {emailTranscripts.map((t,i)=>{
              const isAgent = t.speaker==="PILOT" || t.role==="PILOT";
              return (
                <div key={i} style={{ display:"flex", justifyContent:isAgent?"flex-start":"flex-end",
                                       marginBottom:"0.7rem", animation:"fadeIn 0.3s ease" }}>
                  {isAgent&&(
                    <div style={{ width:28,height:28,borderRadius:"50%",background:C.amber,
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  marginRight:"0.4rem",flexShrink:0,fontSize:"0.75rem" }}>🤖</div>
                  )}
                  <div style={{ maxWidth:"68%", padding:"0.65rem 0.85rem",
                                background:isAgent?"#fff":C.blue,
                                color:isAgent?C.text1:"#fff",
                                borderRadius:isAgent?"12px 12px 12px 3px":"12px 12px 3px 12px",
                                fontSize:"0.85rem", lineHeight:1.55,
                                border:isAgent?`1.5px solid ${C.border}`:"none",
                                boxShadow:isAgent?"0 2px 8px rgba(0,0,0,0.04)":"none" }}>
                    {renderTranscriptText(t.text)}
                  </div>
                  {!isAgent&&(
                    <div style={{ width:28,height:28,borderRadius:"50%",background:C.amberDark,
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  marginLeft:"0.4rem",flexShrink:0,color:"#fff",fontSize:"0.68rem",fontWeight:700 }}>
                      {(t.speaker||"U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef}/>
          </div>

          {/* text input */}
          <div style={{ display:"flex", gap:"0.6rem", padding:"0.65rem 0.85rem",
                        background:"#fff", borderTop:`1.5px solid ${C.border}`, flexShrink:0,
                        alignItems:"flex-end" }}>
            <button style={{ width:28,height:28,borderRadius:7,background:"#F0EDE8",
                             border:`1.5px solid ${C.border}`,fontSize:"0.9rem",flexShrink:0 }}>+</button>
            <input value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{
                if(e.key==="Enter"&&input.trim()){
                  // local only — doesn't pollute other views
                  setInput("");
                }
              }}
              style={{ flex:1, padding:"0.55rem 0.8rem", borderRadius:10,
                       border:`1.5px solid ${C.border}`, fontSize:"0.85rem",
                       background:"#F9F8F6", outline:"none" }}
              placeholder="Type a message or command override..."/>
            <button style={{ padding:"0.55rem 1rem", borderRadius:10, background:C.amberDark,
                             border:"none", color:"#fff", fontWeight:600, fontSize:"0.85rem" }}>
              ▶ Send
            </button>
          </div>
        </div>

        {/* task queue */}
        <div style={{ width:210, background:"#fff", borderLeft:`1.5px solid ${C.border}`,
                      padding:"0.85rem", overflowY:"auto", flexShrink:0 }}>
          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, marginBottom:"0.6rem" }}>TASK QUEUE</div>
          {liveTasks.length === 0
            ? <div style={{ fontSize:"0.72rem", color:C.text3 }}>No tasks yet. Start a call.</div>
            : liveTasks.map((t,i)=>(
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"stretch",
                                     padding:"0.55rem", borderRadius:8, marginBottom:"0.3rem",
                                     background:t.status==="running"?C.amberBg:"transparent",
                                     border:`1.5px solid ${t.status==="running"?C.amber:C.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:"0.45rem" }}>
                  <div style={{ width:16,height:16,borderRadius:"50%",flexShrink:0,
                                background:(t.status==="ok" || t.status==="success")?C.green:t.status==="running"?C.amber:"#F0EDE8",
                                display:"flex",alignItems:"center",justifyContent:"center",
                                fontSize:"0.55rem",color:"#fff" }}>
                    {(t.status==="ok" || t.status==="success")?"✓":t.status==="running"?"●":"○"}
                  </div>
                  <span style={{ fontSize:"0.74rem", fontWeight:600,
                                 textDecoration:(t.status==="ok" || t.status==="success")?"line-through":"none",
                                 color:(t.status==="ok" || t.status==="success")?"#AAA":C.text1 }}>
                    {toolLabel[t.tool] || t.tool}
                  </span>
                </div>
                <div style={{ paddingLeft: 20 }}>
                  <LiveTaskStatus tool={t.tool} status={t.status} />
                </div>
              </div>
            ))
          }

          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, margin:"1rem 0 0.6rem" }}>STATUS TIMELINE</div>
          {timeline.map((s,i)=>(
            <div key={i} style={{ display:"flex", gap:"0.45rem", marginBottom:"0.65rem" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ width:11,height:11,borderRadius:"50%",flexShrink:0,
                              background:s.done?C.green:s.active?C.amber:C.border }}/>
                {i<timeline.length-1&&<div style={{ width:2,height:18,background:C.border }}/>}
              </div>
              <div>
                <div style={{ fontSize:"0.75rem", fontWeight:600,
                              color:s.active?C.text1:C.text3 }}>{s.l}</div>
                <div style={{ fontSize:"0.65rem", color:s.active?C.amber:"#AAA" }}>{s.t}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <LiveTranscriptBar
        transcripts={emailTranscripts} agentStatus={sess.agentStatus}
        isListening={sess.isListening} level={sess.level}
        onToggle={() => sess.toggle("email")}
      />
    </div>
  );
}

/* ── JIRA STANDUP CENTER PAGE ── */
export function JiraPageView() {
  const sess    = useSession();
  const store   = useAppStore();
  const ts      = sess.transcripts;
  const [input, setInput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const t = setInterval(()=>setElapsed(e=>e+1), 1000);
    return ()=>clearInterval(t);
  },[]);

  const jiraTranscripts = ts.filter(t => isJiraRelated(t.text));

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); }, [jiraTranscripts.length]);

  const mm = String(Math.floor(elapsed/60)).padStart(2,"0");
  const ss = String(elapsed%60).padStart(2,"0");

  // Filter tool cards for JIRA activities
  const jiraTools = ["jira_comment", "jira_transition"];
  const liveTasks = store.toolCards.filter(c => jiraTools.includes(c.tool));

  // Find the last completed JIRA update card to populate board mock preview
  const lastCommentCard = store.toolCards.slice().reverse().find(c => c.tool === "jira_comment" && c.status === "ok");
  const lastCommentResult = lastCommentCard?.result as any;
  const lastCommentText = lastCommentResult?.comment || "";
  const lastCommentIssue = lastCommentResult?.issue_id || "";

  const lastTransitionCard = store.toolCards.slice().reverse().find(c => c.tool === "jira_transition" && c.status === "ok");
  const lastTransitionResult = lastTransitionCard?.result as any;
  const lastTransitionState = lastTransitionResult?.status_field || "";
  const lastTransitionIssue = lastTransitionResult?.issue_id || "";

  const toolLabel: Record<string,string> = {
    jira_comment: "Add JIRA Issue Comment",
    jira_transition: "Transition Issue Status",
  };

  const now = new Date();
  const fmt = (d:Date) => d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const timeline = [
    {l:"JIRA Standup integrated", t: fmt(new Date(now.getTime() - elapsed*1000)), done:true, active:false},
    ...liveTasks.map(c => ({
      l: toolLabel[c.tool] || c.tool,
      t: c.status === "ok" ? "Done" : c.status === "running" ? "In progress…" : "Pending",
      done: c.status === "ok",
      active: c.status === "running",
    })),
  ];

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      {/* header */}
      <div style={{ padding:"0.85rem 1.5rem", background:C.surface,
                    borderBottom:`1.5px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <h2 style={{ fontWeight:800, fontSize:"1rem" }}>Active Session: JIRA Standup Tracker</h2>
            <p style={{ fontSize:"0.75rem", color:C.text3 }}>Automated Scrum Standup comment logging and role-based ticket transitions.</p>
          </div>
          <div style={{ display:"flex", gap:"0.75rem", alignItems:"center" }}>
            <button onClick={()=>sess.toggle("general")}
              style={{ display:"flex", alignItems:"center", gap:"0.4rem",
                       padding:"0.35rem 0.8rem", borderRadius:20,
                       background: sess.isListening ? C.amberBg : "#F0EDE8",
                       border:`1.5px solid ${sess.isListening ? C.amber : C.border}`,
                       fontSize:"0.75rem", color:C.amberDark, fontWeight:600, cursor:"pointer" }}>
              <span style={{ width:7,height:7,borderRadius:"50%",background:C.amber,
                             display:"inline-block" }}/>
              {sess.isListening ? "Live Call" : "Start Call"}
            </button>
            <span style={{ fontSize:"0.8rem", color:C.text2, fontFamily:"monospace" }}>{mm}:{ss}</span>
          </div>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Left Workspace - JIRA Sprint Board Preview */}
        <div style={{ width:280, background:"#F9F8F6", borderRight:`1.5px solid ${C.border}`,
                      padding:"1rem", overflowY:"auto", flexShrink:0, display:"flex",
                      flexDirection:"column", gap:"0.75rem" }}>
          <div style={{ fontSize:"0.72rem", fontWeight:800, letterSpacing:"0.08em",
                        color:C.text2, marginBottom:"0.25rem", borderBottom:`1px solid ${C.border}`, paddingBottom:"0.35rem" }}>
            MOCK JIRA BOARD STATUS
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {/* JIRA-42 */}
            <div style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                <span style={{ fontWeight: 800, fontSize: "0.78rem", color: C.amberDark }}>JIRA-42</span>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#fff", background: (lastTransitionIssue === "JIRA-42" ? lastTransitionState : "In Progress") === "Done" ? C.green : C.amber, padding: "2px 6px", borderRadius: 4 }}>
                  {lastTransitionIssue === "JIRA-42" ? lastTransitionState : "In Progress"}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: C.text1 }}>Auth module integration with JIRA metrics</div>
              
              {/* Comments tracking */}
              <div style={{ marginTop: "0.5rem", borderTop: `1px dashed ${C.border}`, paddingTop: "0.4rem" }}>
                <span style={{ fontSize: "0.62rem", fontWeight: 700, color: C.text3 }}>RECENT DEV COMMENT:</span>
                <p style={{ fontSize: "0.7rem", color: C.text2, fontStyle: "italic", marginTop: 2 }}>
                  {lastCommentIssue === "JIRA-42" ? `"${lastCommentText}"` : '"No updates logged yet"'}
                </p>
              </div>
            </div>

            {/* JIRA-88 */}
            <div style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                <span style={{ fontWeight: 800, fontSize: "0.78rem", color: C.amberDark }}>JIRA-88</span>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#fff", background: (lastTransitionIssue === "JIRA-88" ? lastTransitionState : "In Progress") === "Done" ? C.green : C.amber, padding: "2px 6px", borderRadius: 4 }}>
                  {lastTransitionIssue === "JIRA-88" ? lastTransitionState : "In Progress"}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: C.text1 }}>Database connection pooling optimization</div>
              
              {/* Comments tracking */}
              <div style={{ marginTop: "0.5rem", borderTop: `1px dashed ${C.border}`, paddingTop: "0.4rem" }}>
                <span style={{ fontSize: "0.62rem", fontWeight: 700, color: C.text3 }}>RECENT DEV COMMENT:</span>
                <p style={{ fontSize: "0.7rem", color: C.text2, fontStyle: "italic", marginTop: 2 }}>
                  {lastCommentIssue === "JIRA-88" ? `"${lastCommentText}"` : '"No updates logged yet"'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* chat */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"0.65rem",
                        padding:"0.65rem 1rem", background:"#fff",
                        borderBottom:`1.5px solid ${C.border}`, flexShrink:0 }}>
            <div style={{ width:32,height:32,borderRadius:"50%",background:"#E5E7EB",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem" }}>🧑</div>
            <div>
              <div style={{ fontWeight:600, fontSize:"0.85rem" }}>Standup Scrum Master</div>
              <div style={{ fontSize:"0.68rem", color:C.text3 }}>
                {sess.isListening ? "Speaking..." : "Connected"}
              </div>
            </div>
            {sess.isListening && (
              <div style={{ marginLeft:"auto" }}>
                <WaveBars active={true} level={sess.level} count={5}/>
              </div>
            )}
          </div>

          {/* messages = session-scoped transcripts */}
          <div style={{ flex:1, overflowY:"auto", padding:"0.85rem" }}>
            {jiraTranscripts.length===0 && (
              <div style={{ textAlign:"center", color:C.text3, fontSize:"0.82rem", marginTop:"2rem" }}>
                Start a session and speak to see the live conversation.
              </div>
            )}
            {jiraTranscripts.map((t,i)=>{
              const isAgent = t.speaker==="PILOT" || t.role==="PILOT";
              return (
                <div key={i} style={{ display:"flex", justifyContent:isAgent?"flex-start":"flex-end",
                                       marginBottom:"0.7rem", animation:"fadeIn 0.3s ease" }}>
                  {isAgent&&(
                    <div style={{ width:28,height:28,borderRadius:"50%",background:C.amber,
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  marginRight:"0.4rem",flexShrink:0,fontSize:"0.75rem" }}>🤖</div>
                  )}
                  <div style={{ maxWidth:"68%", padding:"0.65rem 0.85rem",
                                background:isAgent?"#fff":C.blue,
                                color:isAgent?C.text1:"#fff",
                                borderRadius:isAgent?"12px 12px 12px 3px":"12px 12px 3px 12px",
                                fontSize:"0.85rem", lineHeight:1.55,
                                border:isAgent?`1.5px solid ${C.border}`:"none",
                                boxShadow:isAgent?"0 2px 8px rgba(0,0,0,0.04)":"none" }}>
                    {renderTranscriptText(t.text)}
                  </div>
                  {!isAgent&&(
                    <div style={{ width:28,height:28,borderRadius:"50%",background:C.amberDark,
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  marginLeft:"0.4rem",flexShrink:0,color:"#fff",fontSize:"0.68rem",fontWeight:700 }}>
                      {(t.speaker||"U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef}/>
          </div>

          {/* text input */}
          <div style={{ display:"flex", gap:"0.6rem", padding:"0.65rem 0.85rem",
                        background:"#fff", borderTop:`1.5px solid ${C.border}`, flexShrink:0,
                        alignItems:"flex-end" }}>
            <button style={{ width:28,height:28,borderRadius:7,background:"#F0EDE8",
                             border:`1.5px solid ${C.border}`,fontSize:"0.9rem",flexShrink:0 }}>+</button>
            <input value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{
                if(e.key==="Enter"&&input.trim()){
                  // local only — doesn't pollute other views
                  setInput("");
                }
              }}
              style={{ flex:1, padding:"0.55rem 0.8rem", borderRadius:10,
                       border:`1.5px solid ${C.border}`, fontSize:"0.85rem",
                       background:"#F9F8F6", outline:"none" }}
              placeholder="Type a message or command override..."/>
            <button style={{ padding:"0.55rem 1rem", borderRadius:10, background:C.amberDark,
                             border:"none", color:"#fff", fontWeight:600, fontSize:"0.85rem" }}>
              ▶ Send
            </button>
          </div>
        </div>

        {/* task queue */}
        <div style={{ width:210, background:"#fff", borderLeft:`1.5px solid ${C.border}`,
                      padding:"0.85rem", overflowY:"auto", flexShrink:0 }}>
          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, marginBottom:"0.6rem" }}>TASK QUEUE</div>
          {liveTasks.length === 0
            ? <div style={{ fontSize:"0.72rem", color:C.text3 }}>No tasks yet. Start a call.</div>
            : liveTasks.map((t,i)=>(
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"stretch",
                                     padding:"0.55rem", borderRadius:8, marginBottom:"0.3rem",
                                     background:t.status==="running"?C.amberBg:"transparent",
                                     border:`1.5px solid ${t.status==="running"?C.amber:C.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:"0.45rem" }}>
                  <div style={{ width:16,height:16,borderRadius:"50%",flexShrink:0,
                                background:(t.status==="ok" || t.status==="success")?C.green:t.status==="running"?C.amber:"#F0EDE8",
                                display:"flex",alignItems:"center",justifyContent:"center",
                                fontSize:"0.55rem",color:"#fff" }}>
                    {(t.status==="ok" || t.status==="success")?"✓":t.status==="running"?"●":"○"}
                  </div>
                  <span style={{ fontSize:"0.74rem", fontWeight:700,
                                 textDecoration:(t.status==="ok" || t.status==="success")?"line-through":"none",
                                 color:(t.status==="ok" || t.status==="success")?"#AAA":C.text1 }}>
                    {toolLabel[t.tool] || t.tool}
                  </span>
                </div>
                <div style={{ paddingLeft: 20 }}>
                  <LiveTaskStatus tool={t.tool} status={t.status} />
                </div>
              </div>
            ))
          }

          <div style={{ fontSize:"0.68rem", fontWeight:700, letterSpacing:"0.08em",
                        color:C.text3, margin:"1rem 0 0.6rem" }}>STATUS TIMELINE</div>
          {timeline.map((s,i)=>(
            <div key={i} style={{ display:"flex", gap:"0.45rem", marginBottom:"0.65rem" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ width:11,height:11,borderRadius:"50%",flexShrink:0,
                              background:s.done?C.green:s.active?C.amber:C.border }}/>
                {i<timeline.length-1&&<div style={{ width:2,height:18,background:C.border }}/>}
              </div>
              <div>
                <div style={{ fontSize:"0.75rem", fontWeight:600,
                              color:s.active?C.text1:C.text3 }}>{s.l}</div>
                <div style={{ fontSize:"0.65rem", color:s.active?C.amber:"#AAA" }}>{s.t}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <LiveTranscriptBar
        transcripts={jiraTranscripts} agentStatus={sess.agentStatus}
        isListening={sess.isListening} level={sess.level}
        onToggle={() => sess.toggle("general")}
      />
    </div>
  );
}
