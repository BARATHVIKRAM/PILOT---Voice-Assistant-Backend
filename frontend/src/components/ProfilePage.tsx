/**
 * Profile + Settings pages — matching PILOT design system.
 * Dark/light mode, user details, voice settings.
 */
import React, { useState } from "react";
import { useAppStore } from "../store/SessionStore";

function useC() {
  const theme = useAppStore(s => s.theme);
  return theme === "dark"
    ? { bg:"#0F0F0F", surface:"#1A1A1A", card:"#222", border:"#2A2A2A",
        text1:"#F0F0F0", text2:"#AAA", text3:"#666",
        amber:"#F5A700", amberDark:"#D4900F", amberBg:"rgba(245,167,0,0.12)", green: "#22C55E" }
    : { bg:"#F7F6F3", surface:"#FFFFFF", card:"#F9F8F6", border:"#E5E2DA",
        text1:"#1A1A1A", text2:"#555", text3:"#888",
        amber:"#F5A700", amberDark:"#7C5E00", amberBg:"#FFF8E7", green: "#22C55E" };
}

const inp = (C: ReturnType<typeof useC>): React.CSSProperties => ({
  width:"100%", padding:"0.65rem 0.9rem", borderRadius:8,
  border:`1.5px solid ${C.border}`, background:C.surface,
  color:C.text1, fontSize:"0.88rem", outline:"none",
});

function Toggle({ on, onChange, label }: { on:boolean; onChange:(v:boolean)=>void; label:string }) {
  const C = useC();
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"0.75rem 0", borderBottom:`1px solid ${C.border}` }}>
      <span style={{ fontSize:"0.88rem", color:C.text1 }}>{label}</span>
      <div onClick={() => onChange(!on)}
        style={{ width:44, height:24, borderRadius:12, cursor:"pointer",
                 background: on ? C.amber : C.border,
                 position:"relative", transition:"background 0.2s" }}>
        <div style={{ position:"absolute", top:3, left: on ? 23 : 3,
                      width:18, height:18, borderRadius:"50%",
                      background:"#fff", transition:"left 0.2s",
                      boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }}/>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const store = useAppStore();
  const C     = useC();
  const user  = store.user;
  const [name,  setName]  = useState(user?.name  || "");
  const [email, setEmail] = useState(user?.email || "");
  const [saved, setSaved] = useState(false);

  function save() {
    if (user) {
      const updated = { ...user, name, email };
      localStorage.setItem("pilot_user", JSON.stringify(updated));
      store.setUser(updated, store.token!);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  const roleColors: Record<string,string> = {
    admin:"#EF4444", manager:"#F5A700", csr:"#3B82F6",
    developer:"#22C55E", operator:"#8B5CF6",
  };

  return (
    <div style={{ flex:1, overflow:"auto", background:C.bg, padding:"2rem 2.5rem" }}>
      <div style={{ maxWidth:680, margin:"0 auto" }}>
        {/* header */}
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", marginBottom:"2rem" }}>
          <button onClick={() => store.setPage("dashboard")}
            style={{ background:"none", border:"none", color:C.text3,
                     cursor:"pointer", fontSize:"1.2rem", padding:"0.25rem" }}>←</button>
          <h1 style={{ fontSize:"1.6rem", fontWeight:800, color:C.text1 }}>Profile</h1>
        </div>

        {/* Avatar + identity */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}`, marginBottom:"1.25rem",
                      display:"flex", alignItems:"center", gap:"1.5rem" }}>
          <div style={{ width:72, height:72, borderRadius:"50%",
                        background:C.amber, display:"flex", alignItems:"center",
                        justifyContent:"center", color:"#fff",
                        fontWeight:800, fontSize:"1.6rem", flexShrink:0 }}>
            {(user?.name||"U").charAt(0).toUpperCase()}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"1.1rem", fontWeight:700, color:C.text1 }}>{user?.name}</div>
            <div style={{ fontSize:"0.85rem", color:C.text2, margin:"0.2rem 0" }}>{user?.email}</div>
            <div style={{ display:"inline-flex", alignItems:"center", gap:"0.35rem",
                          padding:"0.2rem 0.65rem", borderRadius:20, marginTop:"0.3rem",
                          background: `${roleColors[user?.role||"developer"]}22`,
                          color: roleColors[user?.role||"developer"],
                          fontSize:"0.72rem", fontWeight:700 }}>
              {user?.role?.toUpperCase()}
            </div>
          </div>
          <div style={{ fontSize:"0.75rem", color:C.text3, fontFamily:"monospace" }}>
            ID #{user?.id || "—"}
          </div>
        </div>

        {/* Edit details */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}`, marginBottom:"1.25rem" }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:C.text1, marginBottom:"1rem" }}>
            Account Details
          </h3>
          <label style={{ fontSize:"0.78rem", fontWeight:500, color:C.text2, display:"block", marginBottom:"0.3rem" }}>
            Full Name
          </label>
          <input style={{...inp(C), marginBottom:"0.85rem"}} value={name} onChange={e=>setName(e.target.value)}/>
          <label style={{ fontSize:"0.78rem", fontWeight:500, color:C.text2, display:"block", marginBottom:"0.3rem" }}>
            Email
          </label>
          <input style={{...inp(C), marginBottom:"0.85rem"}} type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
          <label style={{ fontSize:"0.78rem", fontWeight:500, color:C.text2, display:"block", marginBottom:"0.3rem" }}>
            Role
          </label>
          <input style={{...inp(C), background:C.card, cursor:"not-allowed"}}
            value={user?.role||""} readOnly/>
          <button onClick={save}
            style={{ marginTop:"1rem", padding:"0.65rem 1.5rem", borderRadius:10,
                     background: saved ? "#22C55E" : C.amber, border:"none",
                     color:"#fff", fontWeight:600, cursor:"pointer", fontSize:"0.88rem",
                     transition:"background 0.2s" }}>
            {saved ? "✓ Saved" : "Save Changes"}
          </button>
        </div>

        {/* Voice ID */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}`, marginBottom:"1.25rem" }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:C.text1, marginBottom:"1rem" }}>
            Voice Identity
          </h3>
          <div style={{ display:"flex", alignItems:"center", gap:"1rem",
                        padding:"0.85rem 1rem", background:C.card, borderRadius:10 }}>
            <div style={{ fontSize:"1.5rem" }}>🔒</div>
            <div>
              <div style={{ fontSize:"0.85rem", fontWeight:600, color:C.text1 }}>
                Voice Profile Active
              </div>
              <div style={{ fontSize:"0.75rem", color:C.text3 }}>
                Biometric voice model enrolled. Used for speaker identification and RBAC.
              </div>
            </div>
            <button onClick={() => store.setPage("enroll")}
              style={{ marginLeft:"auto", padding:"0.4rem 0.85rem", borderRadius:8,
                       background:C.amberBg, border:`1.5px solid ${C.amber}`,
                       color:C.amberDark, fontWeight:600, fontSize:"0.75rem", cursor:"pointer" }}>
              Re-enroll
            </button>
          </div>
        </div>

        {/* Danger zone */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:"1.5px solid rgba(239,68,68,0.2)" }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:"#EF4444", marginBottom:"1rem" }}>
            Account Actions
          </h3>
          <button onClick={store.logout}
            style={{ padding:"0.6rem 1.25rem", borderRadius:8,
                     background:"rgba(239,68,68,0.1)", border:"1.5px solid rgba(239,68,68,0.3)",
                     color:"#EF4444", fontWeight:600, fontSize:"0.85rem", cursor:"pointer" }}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const store  = useAppStore();
  const C      = useC();
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey,   setGroqKey]   = useState("");
  const [saved,     setSaved]     = useState(false);
  const [noiseSuppress, setNoiseSuppress] = useState(true);
  const [autoListen,    setAutoListen]    = useState(true);
  const [showTranscript,setShowTranscript]= useState(true);
  const [micGain,       setMicGain]       = useState(1.2);

  const isDark = store.theme === "dark";

  async function saveKeys() {
    // Store in .env isn't possible from browser — show instructions
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ flex:1, overflow:"auto", background:C.bg, padding:"2rem 2.5rem" }}>
      <div style={{ maxWidth:680, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", marginBottom:"2rem" }}>
          <button onClick={() => store.setPage("dashboard")}
            style={{ background:"none", border:"none", color:C.text3, cursor:"pointer", fontSize:"1.2rem" }}>←</button>
          <h1 style={{ fontSize:"1.6rem", fontWeight:800, color:C.text1 }}>Settings</h1>
        </div>

        {/* Voice settings */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}`, marginBottom:"1.25rem" }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:C.text1, marginBottom:"0.75rem" }}>
            Voice & Audio
          </h3>
          <Toggle on={noiseSuppress}    onChange={setNoiseSuppress}    label="Noise Suppression"/>
          <Toggle on={autoListen}       onChange={setAutoListen}       label="Auto-resume after PILOT speaks"/>
          <Toggle on={showTranscript}   onChange={setShowTranscript}   label="Show live transcript bar"/>
          
          {/* New Interactive Audio Parameters */}
          <div style={{ marginTop: "1rem", borderTop: `1px dashed ${C.border}`, paddingTop: "1rem" }}>
            <h4 style={{ fontSize: "0.82rem", fontWeight: 700, color: C.text1, marginBottom: "0.6rem" }}>Cognitive VAD Thresholds</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: C.text2, marginBottom: "0.25rem" }}>
                  <span>Smart-Turn Buffer Threshold</span>
                  <span style={{ fontWeight: 600, color: C.amberDark }}>15 seconds</span>
                </div>
                <input type="range" min="5" max="30" defaultValue="15" disabled
                  style={{ width: "100%", accentColor: C.amber, height: 4, borderRadius: 2, background: C.border, cursor: "not-allowed" }}/>
                <span style={{ fontSize: "0.65rem", color: C.text3 }}>Accumulated safety thought timeout prior to forcing transcription.</span>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: C.text2, marginBottom: "0.25rem" }}>
                  <span>Mic Gain Boost</span>
                  <span style={{ fontWeight: 600, color: C.amberDark }}>{micGain}x</span>
                </div>
                <input type="range" min="0.5" max="2.0" step="0.1" value={micGain} onChange={e => setMicGain(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: C.amber, height: 4, borderRadius: 2, background: C.border, cursor: "pointer" }}/>
                <span style={{ fontSize: "0.65rem", color: C.text3 }}>Preamplification gain applied to edge audio chunk streams.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Local Orchestrator Routing */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}`, marginBottom:"1.25rem" }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:C.text1, marginBottom:"0.75rem" }}>
            LLM Orchestrator Routing
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: C.text1 }}>Cognitive FrontLLM</div>
                <div style={{ fontSize: "0.72rem", color: C.text3 }}>Classification, Intent and RBAC</div>
              </div>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: C.green, background: `${C.green}15`, padding: "2px 8px", borderRadius: 4 }}>LOCAL (Ollama)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0" }}>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: C.text1 }}>Background Agent</div>
                <div style={{ fontSize: "0.72rem", color: C.text3 }}>Subtask Summary & Code Gen</div>
              </div>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: C.amberDark, background: C.amberBg, padding: "2px 8px", borderRadius: 4 }}>HYBRID (Gemini + Local)</span>
            </div>
          </div>
        </div>

        {/* API Keys */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}`, marginBottom:"1.25rem" }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:C.text1, marginBottom:"0.5rem" }}>
            AI Model Keys
          </h3>
          <p style={{ fontSize:"0.78rem", color:C.text3, marginBottom:"1rem" }}>
            Add these to your <code style={{ background:C.card, padding:"1px 6px", borderRadius:4 }}>backend/.env</code> file to enable smarter AI responses.
          </p>
          <label style={{ fontSize:"0.78rem", fontWeight:500, color:C.text2, display:"block", marginBottom:"0.3rem" }}>
            GEMINI_API_KEY
          </label>
          <input style={{...inp(C), marginBottom:"0.85rem", fontFamily:"monospace"}}
            type="password" value={geminiKey} onChange={e=>setGeminiKey(e.target.value)}
            placeholder="AIza..."/>
          <label style={{ fontSize:"0.78rem", fontWeight:500, color:C.text2, display:"block", marginBottom:"0.3rem" }}>
            GROQ_API_KEY
          </label>
          <input style={{...inp(C), marginBottom:"0.85rem", fontFamily:"monospace"}}
            type="password" value={groqKey} onChange={e=>setGroqKey(e.target.value)}
            placeholder="gsk_..."/>
          <div style={{ padding:"0.65rem 0.85rem", background:C.card, borderRadius:8,
                        fontSize:"0.75rem", color:C.text3, marginBottom:"0.75rem" }}>
            💡 Add to <strong style={{color:C.text2}}>backend/.env</strong>:<br/>
            <code>GEMINI_API_KEY={geminiKey||"your_key_here"}</code><br/>
            <code>GROQ_API_KEY={groqKey||"your_key_here"}</code>
          </div>
        </div>

        {/* About */}
        <div style={{ background:C.surface, borderRadius:16, padding:"1.5rem",
                      border:`1.5px solid ${C.border}` }}>
          <h3 style={{ fontSize:"0.9rem", fontWeight:700, color:C.text1, marginBottom:"0.75rem" }}>About PILOT</h3>
          <div style={{ fontSize:"0.82rem", color:C.text2, lineHeight:1.7 }}>
            <div>Version <strong>1.0.0</strong> · Grid Dynamics Capstone 2026</div>
            <div>Pipeline: Whisper distil-large-v3 · Qwen3:8B · Sortformer · WeSpeaker</div>
            <div>TTS: Edge TTS (neural) · macOS Samantha (offline)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
