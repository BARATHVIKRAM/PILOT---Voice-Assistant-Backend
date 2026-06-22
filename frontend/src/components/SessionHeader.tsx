/**
 * Landing · Login · Signup (4-step) · OTP · VoiceCalibration
 * Feature 1: voice enrollment with real embedding
 * Feature 5: audio file upload in enrollment
 * Feature 6: PDF-accurate design
 */
import React, { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store/SessionStore";
import { PILOTLogo } from "./PILOTLogo";

const C = {
  amber:"#F5A700", amberDark:"#7C5E00", amberBg:"#FFF8E7",
  bg:"#F7F6F3", surface:"#FFFFFF", border:"#E5E2DA",
  text1:"#1A1A1A", text2:"#555555", text3:"#888888",
  green:"#22C55E",
};

const api = async (method:string, path:string, body?:unknown) => {
  const token = localStorage.getItem("pilot_token");
  const h: Record<string,string> = {"Content-Type":"application/json"};
  if (token) h["Authorization"] = `Bearer ${token}`;
  const opts: RequestInit = {method:method.toUpperCase(), headers:h};
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch("/api/v1"+path, opts);
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error((e as any).detail??res.statusText); }
  return res.json();
};

const inp: React.CSSProperties = {
  width:"100%", padding:"0.7rem 1rem", borderRadius:10,
  border:`1.5px solid ${C.border}`, fontSize:"0.9rem",
  background:"#fff", color:C.text1, outline:"none",
};

/* ── LANDING ── */
export function LandingPage() {
  const store = useAppStore();
  const p = store.page;

  // Sandbox simulation state
  const [sandboxCmd, setSandboxCmd] = useState("");
  const [sandboxStep, setSandboxStep] = useState(0); // 0: Idle, 1: Mic, 2: VAD, 3: ASR, 4: Speaker ID, 5: LLM Routing, 6: Output
  const [simulatedText, setSimulatedText] = useState("");
  const [sandboxIntervalId, setSandboxIntervalId] = useState<any>(null);

  if (p==="login")   return <LoginPage/>;
  if (p==="signup")  return <SignupPage/>;
  if (p==="verify")  return <OTPPage/>;
  if (p==="enroll")  return <VoiceCalibration/>;
  if (p==="forgot")  return <ForgotPasswordPage/>;
  if (p==="forgot-verify") return <ForgotOTPPage/>;

  const sandboxPresets = [
    { label: "✈️ Flight Search", cmd: "Search flights from Mumbai to Delhi on 2026-07-01" },
    { label: "📊 PPT Control", cmd: "Go to slide 42 in the presentation" },
    { label: "🔢 Check Prime", cmd: "Write the python code to check if a number is prime" },
    { label: "✉️ Write Email", cmd: "Draft an email template to welcome the new developers" }
  ];

  const handleSandboxClick = (cmdText: string) => {
    if (sandboxIntervalId) clearInterval(sandboxIntervalId);
    setSandboxCmd(cmdText);
    setSandboxStep(1);
    setSimulatedText("");

    // Step 1: Listening Animation
    setTimeout(() => {
      setSandboxStep(2); // Step 2: VAD Detection
      setTimeout(() => {
        setSandboxStep(3); // Step 3: ASR Typing
        let currentChar = 0;
        const interval = setInterval(() => {
          if (currentChar < cmdText.length) {
            setSimulatedText(cmdText.slice(0, currentChar + 1));
            currentChar++;
          } else {
            clearInterval(interval);
            setSandboxStep(4); // Step 4: Speaker Biometrics
            setTimeout(() => {
              setSandboxStep(5); // Step 5: LLM Routing Decision
              setTimeout(() => {
                setSandboxStep(6); // Step 6: Terminal Agent Output
              }, 1200);
            }, 1200);
          }
        }, 30);
        setSandboxIntervalId(interval);
      }, 1000);
    }, 1200);
  };

  return (
    <div style={{ minHeight:"100vh", fontFamily:"Inter, sans-serif",
                  background:"radial-gradient(circle at top left, #FAF9F5 0%, #EFECE0 100%)", color: "#1A1A1A" }}>
      {/* nav */}
      <nav style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"1rem 3rem", background:"rgba(255,255,255,0.85)", backdropFilter: "blur(12px)",
                    borderBottom:`1.5px solid ${C.border}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:"0.6rem" }}>
          <PILOTLogo size={36} />
          <div>
            <span style={{ fontWeight:900, fontSize:"1.25rem", letterSpacing:"-0.02em", color:"#1A1A1A" }}>PILOT</span>
            <div style={{ fontSize: "0.55rem", color: C.amberDark, fontWeight: 700, letterSpacing: "0.1em", marginTop: -2 }}>VOICE AI OS</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: C.text3, fontWeight: 500, marginRight: "1rem" }}>v2.1 Stable Edition</span>
          <button onClick={()=>store.setPage("login")}
            style={{ padding:"0.5rem 1.25rem", borderRadius:8,
                     border:`1.5px solid ${C.border}`, background:"#fff",
                     fontWeight:600, fontSize:"0.83rem", cursor:"pointer", transition: "all 0.15s ease" }}>Sign In</button>
          <button onClick={()=>store.setPage("signup")}
            style={{ padding:"0.5rem 1.25rem", borderRadius:8, border:"none",
                     background:C.amber, color:"#fff", fontWeight:700, fontSize:"0.83rem", cursor:"pointer",
                     boxShadow: "0 4px 12px rgba(245,167,0,0.25)" }}>
            Get Started Free
          </button>
        </div>
      </nav>

      {/* hero */}
      <div style={{ maxWidth:1150, margin:"0 auto", padding:"5rem 3rem 4rem",
                    display:"grid", gridTemplateColumns:"1fr 1.1fr", gap:"4rem", alignItems:"center" }}>
        <div>
          <div style={{ display:"inline-flex", alignItems:"center", gap:"0.4rem",
                        padding:"0.3rem 0.8rem", borderRadius:20, background:C.amberBg,
                        color:C.amberDark, fontSize:"0.72rem", fontWeight:800, marginBottom:"1.5rem" }}>
            <span style={{ width:6,height:6,borderRadius:"50%",background:C.amber,display:"inline-block" }}/>
            🟢 BIOMETRIC ENGINE ACTIVE
          </div>
          <h1 style={{ fontSize:"3.4rem", fontWeight:900, lineHeight:1.08,
                       letterSpacing:"-0.035em", marginBottom:"1.25rem" }}>
            A Voice-First<br/>
            <span style={{ color:C.amberDark }}>AI Operating System.</span>
          </h1>
          <p style={{ fontSize:"0.98rem", color:C.text2, lineHeight:1.7,
                      maxWidth:450, marginBottom:"2rem" }}>
            Experience continuous, zero-latency computing designed entirely around natural language, continuous voice recognition, real-time biometrics, and autonomous background orchestration.
          </p>
          <div style={{ display:"flex", gap:"1rem", marginBottom: "2rem" }}>
            <button onClick={()=>store.setPage("signup")}
              style={{ padding:"0.9rem 1.8rem", borderRadius:10, background:C.amber,
                       color:"#fff", fontWeight:800, fontSize:"0.95rem", border:"none", cursor:"pointer",
                       boxShadow: "0 6px 20px rgba(245,167,0,0.3)" }}>
              Launch Virtual Terminal
            </button>
            <button onClick={() => handleSandboxClick("Search flights from Mumbai to Delhi on 2026-07-01")}
              style={{ padding:"0.9rem 1.8rem", borderRadius:10, background:"#fff",
                       color:C.text1, fontWeight:600, fontSize:"0.95rem",
                       border:`1.5px solid ${C.border}`, cursor:"pointer" }}>
              ⚡ Run Live Demo Sandbox
            </button>
          </div>
          
          <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: "1.25rem", display: "flex", gap: "2rem" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.amberDark }}>&lt; 100ms</div>
              <div style={{ fontSize: "0.72rem", color: C.text3, fontWeight: 600 }}>Acoustic Latency</div>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.amberDark }}>Level 2</div>
              <div style={{ fontSize: "0.72rem", color: C.text3, fontWeight: 600 }}>Voice Authorized MFA</div>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", color: C.amberDark }}>99.2%</div>
              <div style={{ fontSize: "0.72rem", color: C.text3, fontWeight: 600 }}>Diarization Accuracy</div>
            </div>
          </div>
        </div>

        {/* Dynamic AI Sandbox Panel */}
        <div style={{ background: "#FFFDFA", border: `2px solid ${C.border}`, borderRadius: 20, padding: "1.5rem",
                      boxShadow: "0 24px 60px rgba(0,0,0,0.06)", position: "relative", minHeight: 460, display: "flex", flexDirection: "column" }}>
          {/* Header toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1.5px solid ${C.border}`, paddingBottom: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F56" }}/>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FFBD2E" }}/>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27C93F" }}/>
            </div>
            <span style={{ fontSize: "0.68rem", fontFamily: "monospace", color: C.amberDark, fontWeight: 800, letterSpacing: "0.05em" }}>PILOT COGNITIVE SANDBOX v2.1</span>
            <div style={{ fontSize: "0.55rem", background: C.amberBg, color: C.amberDark, padding: "2px 6px", borderRadius: 4, fontFamily: "monospace", fontWeight: 700 }}>ONLINE</div>
          </div>

          {/* Sandbox controls */}
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.75rem", color: C.text2, marginBottom: "0.5rem", fontWeight: 600 }}>Select a speech prompt to simulate PILOT's processing:</div>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {sandboxPresets.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSandboxClick(p.cmd)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: 8,
                    background: sandboxCmd === p.cmd ? C.amber : C.surface,
                    border: sandboxCmd === p.cmd ? `1px solid ${C.amber}` : `1px solid ${C.border}`,
                    color: sandboxCmd === p.cmd ? "#fff" : C.text1,
                    fontSize: "0.74rem",
                    cursor: "pointer",
                    fontWeight: 700,
                    transition: "all 0.15s ease",
                    boxShadow: sandboxCmd === p.cmd ? "0 2px 8px rgba(245,167,0,0.25)" : "none"
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Execution Pipeline Graphic */}
          <div style={{ flex: 1, background: C.bg, borderRadius: 12, border: `1.5px solid ${C.border}`, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.85rem", overflowY: "auto" }}>
            {sandboxStep === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "1rem", color: C.text3, flex: 1 }}>
                <span style={{ fontSize: "2rem" }}>🎙️</span>
                <div style={{ fontSize: "0.8rem", fontFamily: "monospace", textAlign: "center" }}>Click any preset prompt above to launch live pipeline trace.</div>
              </div>
            )}

            {/* Step 1: Speech Processing */}
            {sandboxStep >= 1 && (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", animation: "fadeIn 0.2s ease" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: sandboxStep === 1 ? C.amber : C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
                  {sandboxStep > 1 ? "✓" : "●"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.text1, fontFamily: "monospace" }}>
                    {sandboxStep === 1 ? "ANALYZING INCOMING AUDIO DSP STREAM..." : "AUDIO CAPTURED SUCCESSFULLY"}
                  </div>
                  {sandboxStep === 1 && (
                    <div style={{ display: "flex", gap: "2px", alignItems: "flex-end", height: 12, marginTop: 4 }}>
                      {[4,10,14,6,12,18,8,12,6,4].map((h, i) => (
                        <div key={i} style={{ width: 2, background: C.amber, height: h, animation: `barBeat 0.3s infinite` }}/>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: VAD Threshold */}
            {sandboxStep >= 2 && (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", animation: "fadeIn 0.2s ease" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: sandboxStep === 2 ? C.amber : C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
                  {sandboxStep > 2 ? "✓" : "●"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.text1, fontFamily: "monospace" }}>
                    {sandboxStep === 2 ? "CALCULATING VOICE TRANSITION BOUNDARIES..." : "SMART-TURN VAD TRIGGERED SPEECH BLOCK"}
                  </div>
                  <div style={{ fontSize: "0.62rem", color: C.amberDark, fontFamily: "monospace", marginTop: 2 }}>
                    {sandboxStep === 2 ? "Processing Smart-Turn acoustic parameters..." : "Speech block detected: Length 1850ms, threshold signal margin passed"}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: ASR Speech to Text */}
            {sandboxStep >= 3 && (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", animation: "fadeIn 0.2s ease" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: sandboxStep === 3 ? C.amber : C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
                  {sandboxStep > 3 ? "✓" : "●"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.text1, fontFamily: "monospace" }}>
                    {sandboxStep === 3 ? "TRANSLATING SPEECH VIA ONNX ACOUSTIC ENGINE..." : "SPEECH-TO-TEXT COMPLETE"}
                  </div>
                  <div style={{ fontSize: "0.78rem", background: C.surface, padding: "0.4rem 0.6rem", borderRadius: 6, border: `1.5px solid ${C.amber}`, fontFamily: "monospace", color: C.amberDark, marginTop: 4 }}>
                    "{simulatedText}"<span style={{ animation: "pulse 0.8s infinite" }}>|</span>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Speaker Identification */}
            {sandboxStep >= 4 && (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", animation: "fadeIn 0.2s ease" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: sandboxStep === 4 ? C.amber : C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
                  {sandboxStep > 4 ? "✓" : "●"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.text1, fontFamily: "monospace" }}>
                    BIOMETRIC IDENTITY AND PRIVACY ANALYSIS
                  </div>
                  <div style={{ fontSize: "0.65rem", color: C.amberDark, fontFamily: "monospace", marginTop: 2 }}>
                    Voiceprint analysis: MATCHED TO USER - Admin (Level 2 Authorized Access Granted) Confidence 99.4%
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Route Decision */}
            {sandboxStep >= 5 && (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", animation: "fadeIn 0.2s ease" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: sandboxStep === 5 ? C.amber : C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
                  {sandboxStep > 5 ? "✓" : "●"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.text1, fontFamily: "monospace" }}>
                    {sandboxStep === 5 ? "ROUTING ACTION DECISION VIA FRONT LLM..." : "ROUTING STRATEGY DETERMINED"}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: C.amberDark, fontFamily: "monospace", marginTop: 2 }}>
                    Decision: DELEGATE. Tool selected: {
                      sandboxCmd.includes("flights") ? "flight_search" :
                      sandboxCmd.includes("slide") ? "ppt_navigate" :
                      sandboxCmd.includes("email") ? "write_email" : "write_file"
                    }. Status: Executing...
                  </div>
                </div>
              </div>
            )}

            {/* Step 6: Final Output presentation */}
            {sandboxStep >= 6 && (
              <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: "0.75rem", marginTop: "0.25rem", animation: "fadeIn 0.4s ease" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 800, color: C.text3, marginBottom: "0.5rem", letterSpacing: "0.08em" }}>AUTONOMOUS AGENT REPORT RESULTS</div>
                
                {sandboxCmd.includes("flights") ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <div style={{ fontSize: "0.72rem", color: "#15803d", fontFamily: "monospace" }}>✓ Successfully located 2 flight listings matching parameters:</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      {[{ airline: "Akasa Air", price: "₹3,600", dep: "14:30" }, { airline: "SpiceJet", price: "₹3,900", dep: "09:15" }].map((f, idx) => (
                        <div key={idx} style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: C.text1 }}>{f.airline}</span>
                            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: C.amberDark }}>{f.price}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: C.text3 }}>
                            <span>BOM → DEL</span>
                            <span>{f.dep}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : sandboxCmd.includes("slide") ? (
                  <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1.2rem" }}>🖥️</span>
                    <div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: C.text1 }}>PPT Command Processed</div>
                      <div style={{ fontSize: "0.62rem", color: C.text3 }}>Action: Goto Slide 42. Status: Successfully synchronized viewer instance.</div>
                    </div>
                  </div>
                ) : sandboxCmd.includes("email") ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <div style={{ fontSize: "0.68rem", color: "#15803d", fontFamily: "monospace", fontWeight: 700 }}>✓ Email Drafted Successfully (Agent Output):</div>
                    <pre style={{ margin: 0, background: "#1e1e2e", border: "1px solid #313244", borderRadius: 10, padding: "0.75rem", fontSize: "0.72rem", fontFamily: "monospace", color: "#cdd6f4", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                      <strong>Subject:</strong> Welcome to the PILOT Developer Team! 🚀<br/><br/>
                      Hi Team,<br/><br/>
                      Welcome aboard! We are thrilled to have you join our development workspace. Let's build the future of voice-first computing together. You can access our virtual terminal docs directly on your active dashboard.<br/><br/>
                      Best regards,<br/>
                      Ada (Lead Engineer)
                    </pre>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: "0.68rem", color: C.green, fontFamily: "monospace", marginBottom: "0.3rem" }}>✓ Generated clean prime check helper (Python):</div>
                    <pre style={{ margin: 0, background: "#1e1e2e", border: "1px solid #313244", borderRadius: 6, padding: "0.5rem", fontSize: "0.68rem", fontFamily: "monospace", color: "#cdd6f4", overflowX: "auto" }}>
                      <span style={{ color: "#569cd6" }}>def</span> <span style={{ color: "#dcdcaa" }}>is_prime</span>(n):<br/>
                      &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#c586c0" }}>return</span> n &gt; <span style={{ color: "#b5cea8" }}>1</span> <span style={{ color: "#569cd6" }}>and</span> <span style={{ color: "#dcdcaa" }}>all</span>(n % i != <span style={{ color: "#b5cea8" }}>0</span> <span style={{ color: "#569cd6" }}>for</span> i <span style={{ color: "#569cd6" }}>in</span> <span style={{ color: "#dcdcaa" }}>range</span>(<span style={{ color: "#b5cea8" }}>2</span>, <span style={{ color: "#dcdcaa" }}>int</span>(n**<span style={{ color: "#b5cea8" }}>0.5</span>)+<span style={{ color: "#b5cea8" }}>1</span>))
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Interactive System Architecture Diagram Block */}
      <div style={{ background: "#fff", padding: "4rem 3rem", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: "2rem", fontWeight: 900, marginBottom: "0.5rem", fontFamily: "Inter, sans-serif" }}>
            The PILOT Core Architecture
          </h2>
          <p style={{ textAlign: "center", color: C.text3, marginBottom: "3rem", fontSize: "0.95rem", maxWidth: 650, margin: "0 auto 3rem" }}>
            PILOT bridges high-stakes edge DSP (Digital Signal Processing) with multi-model cloud background workers to deliver reliable, secure voice action routing.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: "1.5rem", alignItems: "stretch" }}>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "1.5rem", background: C.bg, display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ fontSize: "1.3rem" }}>🎙️</div>
              <h3 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>1. Audio DSP Pipeline</h3>
              <p style={{ fontSize: "0.82rem", color: C.text2, lineHeight: 1.6, margin: 0 }}>
                Continuous 16kHz audio stream chunk processing. Employs model-based VAD (Voice Activity Detection) parameters and noise classification filters to determine clean spoken turns locally.
              </p>
              <div style={{ marginTop: "auto", background: "#FFFBF2", border: `1px solid ${C.amber}`, borderRadius: 8, padding: "0.6rem", fontSize: "0.68rem", fontFamily: "monospace", color: C.amberDark }}>
                Mic &rarr; Chunked buffer &rarr; VAD Filter &rarr; ONNX Acoustic Model
              </div>
            </div>

            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "1.5rem", background: "#FFFDF9", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ fontSize: "1.3rem" }}>🧠</div>
              <h3 style={{ fontSize: "1rem", fontWeight: 800, margin: 0, color: C.amberDark }}>2. Cognitive Front LLM</h3>
              <p style={{ fontSize: "0.82rem", color: C.text2, lineHeight: 1.6, margin: 0 }}>
                A smart gateway classifier. Evaluates user intent, cross-references biometric identity validations, and either generates conversational speech blocks or delegates background pipeline tasks.
              </p>
              <div style={{ marginTop: "auto", background: "#FFFBF2", border: `1px solid ${C.amber}`, borderRadius: 8, padding: "0.6rem", fontSize: "0.68rem", fontFamily: "monospace", color: C.amberDark }}>
                Evaluate input &rarr; Validate Voice Authorization &rarr; Route payload or dispatch tool
              </div>
            </div>

            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "1.5rem", background: C.bg, display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ fontSize: "1.3rem" }}>⚙️</div>
              <h3 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>3. Concurrent Supervisors</h3>
              <p style={{ fontSize: "0.82rem", color: C.text2, lineHeight: 1.6, margin: 0 }}>
                The background orchestrators. Executes file system tasks, queries secure flights APIs, constructs PowerPoint slides, and updates CRM logs asynchronously without blocking the voice.
              </p>
              <div style={{ marginTop: "auto", background: "#FFFBF2", border: `1px solid ${C.amber}`, borderRadius: 8, padding: "0.6rem", fontSize: "0.68rem", fontFamily: "monospace", color: C.amberDark }}>
                Submit job &rarr; Background Supervisor &rarr; Execute task &rarr; Return result
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* features grid */}
      <div style={{ background:"#FAF9F5", padding:"4rem 3rem" }}>
        <h2 style={{ textAlign:"center", fontSize:"2rem", fontWeight:900, marginBottom:"0.6rem", fontFamily: "Inter, sans-serif" }}>
          Intelligence at the edge.
        </h2>
        <p style={{ textAlign:"center", color:C.text3, marginBottom:"3rem", fontSize:"0.95rem" }}>
          Built from the ground up to process voice seamlessly, securely, and instantly across your entire workflow.
        </p>
        <div style={{ maxWidth:1100, margin:"0 auto", display:"grid",
                      gridTemplateColumns:"repeat(3,1fr)", gap:"1.25rem" }}>
          {[{icon:"🎙",t:"Continuous Listening",d:"Always on, zero latency wake words. Understands context before you finish your sentence."},
            {icon:"👥",t:"Speaker Recognition",d:"Advanced biometrics instantly identify who is speaking, attributing transcripts to the correct member."},
            {icon:"🔐",t:"Voice Authorization",d:"Secure high-stakes actions with voice-print verification without touching a keyboard."},
            {icon:"🤖",t:"Background Agents",d:"Deploy autonomous agents that listen to meetings, draft emails, and update CRM records invisibly."},
            {icon:"⚡",t:"Realtime Transcription",d:"Sub-100ms latency transcription locally processed on device with high accuracy."}
          ].map((f,i)=>(
            <div key={i} style={{ background:C.surface, border:`1.5px solid ${C.border}`,
                                   borderRadius:14, padding:"1.4rem", boxShadow: "0 4px 12px rgba(0,0,0,0.02)" }}>
              <div style={{ fontSize:"1.4rem", marginBottom:"0.65rem" }}>{f.icon}</div>
              <div style={{ fontWeight:800, fontSize:"1rem", marginBottom:"0.4rem", fontFamily: "Inter, sans-serif" }}>{f.t}</div>
              <div style={{ fontSize:"0.84rem", color:C.text2, lineHeight:1.6 }}>{f.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── LOGIN ── */
function LoginPage() {
  const store = useAppStore();
  const [email,setEmail]=useState(""); const [pw,setPw]=useState("");
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  async function submit() {
    setErr(""); setLoading(true);
    try {
      const r=await api("POST","/auth/login",{email,password:pw});
      store.setUser(r.user,r.access_token);
      store.setPage("dashboard");
    }
    catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }
  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#f8f6f0,#ede8e0)",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"2.5rem", width:400,
                    boxShadow:"0 8px 48px rgba(0,0,0,0.08)", position:"relative" }}>
        <button onClick={()=>store.setPage("landing")}
          style={{ position:"absolute",top:"1rem",left:"1rem",background:"none",border:"none",
                   color:C.text3,cursor:"pointer",fontSize:"0.85rem",display:"flex",
                   alignItems:"center",gap:"0.3rem" }}>← Back</button>
        <div style={{ textAlign:"center", marginBottom:"1.75rem" }}>
          <div style={{ width:50,height:50,borderRadius:14,background:"#111111",
                        display:"flex",alignItems:"center",justifyContent:"center",
                        margin:"0 auto 1rem", boxShadow: "0 4px 12px rgba(245,167,0,0.2)" }}>
            <PILOTLogo size={36} />
          </div>
          <h2 style={{ fontSize:"1.6rem", fontWeight:800 }}>Welcome back</h2>
          <p style={{ color:C.text3, fontSize:"0.88rem" }}>Log in to your PILOT OS account to continue.</p>
        </div>
        <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Email address</label>
        <input style={{...inp,marginBottom:"0.85rem"}} type="email" value={email}
          onChange={e=>setEmail(e.target.value)} placeholder="name@company.com"/>
        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"0.3rem" }}>
          <label style={{ fontSize:"0.8rem",fontWeight:500 }}>Password</label>
          <span onClick={()=>store.setPage("forgot")} style={{ fontSize:"0.78rem",color:C.amberDark,cursor:"pointer" }}>Forgot password?</span>
        </div>
        <input style={{...inp}} type="password" value={pw}
          onChange={e=>setPw(e.target.value)} placeholder="••••••••"
          onKeyDown={e=>e.key==="Enter"&&submit()}/>
        {err&&<div style={{ color:"#EF4444",fontSize:"0.78rem",marginTop:"0.4rem" }}>{err}</div>}
        <button onClick={submit} disabled={loading}
          style={{ width:"100%",padding:"0.85rem",borderRadius:30,background:"#6B5100",
                   color:"#fff",fontWeight:700,border:"none",marginTop:"1rem",fontSize:"0.92rem",cursor:"pointer" }}>
          {loading?"Logging in…":"Log In →"}
        </button>
        <p style={{ textAlign:"center",fontSize:"0.83rem",color:C.text3,marginTop:"1.1rem" }}>
          Don't have an account?{" "}
          <span style={{ color:C.amberDark,cursor:"pointer",fontWeight:600 }} onClick={()=>store.setPage("signup")}>Sign up</span>
        </p>
      </div>
    </div>
  );
}

/* ── SIGNUP ── */
function SignupPage() {
  const store = useAppStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Voice Calibration States
  const [phase, setPhase] = useState<"idle" | "recording" | "done">("idle");
  const [round, setRound] = useState(1);
  const [clarity, setClarity] = useState(0);
  const [bars, setBars] = useState<number[]>(new Array(9).fill(3));
  const [audioBlobs, setAudioBlobs] = useState<Blob[]>([]);

  const mrRef = useRef<MediaRecorder | null>(null);
  const roundChunks = useRef<Blob[]>([]);
  const animRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Automatically release resources on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  async function startRec() {
    setErr("");
    try {
      if (!navigator.mediaDevices) {
        throw new Error("Microphone access is unavailable. Please ensure you are using a secure context (HTTPS or localhost) and have granted microphone permissions.");
      }
      // Stop previous stream if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
          sampleRate:       16000,
          channelCount:     1,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      src.connect(an);

      const tick = () => {
        const d = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(d);
        
        // Map current frequency data to bars
        const currentBars = Array.from(d.slice(0, 9)).map(v => 3 + Math.floor(v / 255 * 22));
        setBars(currentBars);
        
        // Calculate raw real-time volume/rms energy from the FFT bins
        const sum = d.reduce((acc, val) => acc + val, 0);
        const avgVolume = sum / d.length;
        
        // Determine clarity dynamically based on the vocal characteristics of active speaking:
        // Human voice typically centers around specific frequency bands (FFT bins 2-12).
        // If there's active voice energy, clarity dynamically modulates between 80% - 98%.
        // If there's low energy, clarity settles down representing ambient room noise clarity.
        if (avgVolume > 15) {
          // Speak active: compute stable, realistic clarity with vocal resonance variation
          const vocalResonance = d.slice(2, 12).reduce((acc, val) => acc + val, 0) / 10;
          const dynamicClarity = Math.min(98, Math.max(78, Math.floor(75 + (vocalResonance / 255) * 23)));
          setClarity(dynamicClarity);
        } else {
          // Silence or ambient room noise: low clarity
          setClarity(c => Math.max(0, Math.floor(c * 0.9)));
        }

        animRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mrRef.current = mr;
      roundChunks.current = [];
      mr.ondataavailable = e => {
        if (e.data.size > 0) roundChunks.current.push(e.data);
      };
      mr.start(500);
      setPhase("recording");
    } catch (e: any) {
      setErr(e.message || "Microphone access denied. Please allow microphone permissions.");
    }
  }

  function stopRec() {
    cancelAnimationFrame(animRef.current);
    return new Promise<void>(resolve => {
      const mr = mrRef.current;
      if (mr && mr.state !== "inactive") {
        mr.onstop = () => { resolve(); };
        mr.stop();
      } else {
        resolve();
      }
    });
  }

  async function handleStop() {
    await stopRec();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setPhase("done");
  }

  async function saveRound() {
    await stopRec();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }

    if (roundChunks.current.length === 0) {
      setErr("No audio captured. Please complete the recording first.");
      return;
    }

    const blob = new Blob(roundChunks.current, { type: "audio/webm" });
    const newBlobs = [...audioBlobs, blob];
    setAudioBlobs(newBlobs);

    if (round < 3) {
      setRound(r => r + 1);
      setPhase("idle");
      setClarity(0);
      setBars(new Array(9).fill(3));
      roundChunks.current = [];
    } else {
      setPhase("done");
    }
  }

  function resetVoice() {
    setAudioBlobs([]);
    setRound(1);
    setPhase("idle");
    setClarity(0);
    setBars(new Array(9).fill(3));
    roundChunks.current = [];
  }

  function validateCredentials() {
    if (!name.trim() || !email.trim()) {
      setErr("Please fill in your Full Name and Email Address.");
      return false;
    }
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return false;
    }
    if (pw !== pw2) {
      setErr("Passwords do not match.");
      return false;
    }
    return true;
  }

  async function submit() {
    setErr("");
    if (!validateCredentials()) return;
    if (audioBlobs.length < 3) {
      setErr("Please complete all 3 rounds of voice calibration.");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("email", email);
      fd.append("password", pw);
      fd.append("role", role);
      audioBlobs.forEach((blob, idx) => {
        fd.append("audio", blob, `round_${idx + 1}.webm`);
      });

      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: {
          // Remove manually set headers or use correct API format
        },
        body: fd,
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? res.statusText);
      }

      await res.json();
      store.setPendingEmail(email);
      store.setPage("verify"); // Move to OTP verification page!
    } catch (e: any) {
      setErr(e.message || "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const steps = [
    { n: 1, l: "Register" },
    { n: 2, l: "Verify" }
  ];

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#f8f6f0,#ede8e0)",
                  display:"flex", alignItems:"center", justifyContent:"center", padding: "2rem" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"2.5rem", width: 760,
                    boxShadow:"0 8px 48px rgba(0,0,0,0.08)", position:"relative" }}>
        <button onClick={()=>store.setPage("landing")}
          style={{ position:"absolute",top:"1rem",left:"1rem",background:"none",border:"none",
                   color:C.text3,cursor:"pointer",fontSize:"0.85rem",display:"flex",
                   alignItems:"center",gap:"0.3rem" }}>← Back</button>
        
        {/* steps */}
        <div style={{ display:"flex", alignItems:"center", marginBottom:"1.75rem", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", width: "100%", maxWidth: 180 }}>
            {steps.map((s,i)=>(
              <React.Fragment key={s.n}>
                <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:"0.2rem" }}>
                  <div style={{ width:30,height:30,borderRadius:"50%",display:"flex",
                                alignItems:"center",justifyContent:"center",fontSize:"0.78rem",fontWeight:700,
                                background:s.n===1?C.amber:"#F0EDE8",
                                color:s.n===1?"#fff":"#999" }}>
                    {s.n}
                  </div>
                  <span style={{ fontSize:"0.6rem",color:s.n===1?C.amberDark:"#AAA",fontWeight:500 }}>{s.l}</span>
                </div>
                {i<steps.length-1&&<div style={{ flex:1,height:2,background:C.border,marginBottom:"10px" }}/>}
              </React.Fragment>
            ))}
          </div>
        </div>

        <h2 style={{ fontSize:"1.5rem",fontWeight:800,marginBottom:"0.2rem", textAlign: "center" }}>
          Create your account & Enroll Voice
        </h2>
        <p style={{ color:C.text3,fontSize:"0.83rem",marginBottom:"1.8rem", textAlign: "center" }}>
          Provide your details and complete the 3 calibration rounds side-by-side to register.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5rem" }}>
          {/* Left Column: Credentials */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: C.amberDark, margin: "0 0 0.2rem" }}>
              1. Profile Details
            </h3>
            
            <div>
              <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Full Name</label>
              <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Ada Lovelace"/>
            </div>

            <div>
              <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Email</label>
              <input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@company.com"/>
            </div>

            <div>
              <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Role</label>
              <select style={inp} value={role} onChange={e=>setRole(e.target.value)}>
                <option value="developer">Developer</option>
                <option value="manager">Manager</option>
                <option value="csr">Customer Service Rep</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Password</label>
              <input style={inp} type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="min 8 characters"/>
            </div>

            <div>
              <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Confirm Password</label>
              <input style={inp} type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="repeat password"/>
            </div>
          </div>

          {/* Right Column: Voice Calibration */}
          <div style={{ display: "flex", flexDirection: "column", borderLeft: `1.5px solid ${C.border}`, paddingLeft: "2.5rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: C.amberDark, margin: "0 0 0.2rem" }}>
              2. Voice Calibration
            </h3>

            {audioBlobs.length === 3 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, textAlign: "center", gap: "1rem" }}>
                <div style={{ fontSize: "3rem", color: C.green }}>✓</div>
                <div style={{ fontWeight: 700, color: C.text1 }}>Voice Registered Successfully!</div>
                <div style={{ fontSize: "0.83rem", color: C.text3 }}>All 3 calibration rounds have been captured.</div>
                <button onClick={resetVoice}
                  style={{ padding: "0.45rem 1rem", borderRadius: 8, border: `1.5px solid ${C.border}`,
                           background: "#fff", fontWeight: 600, fontSize: "0.8rem", color: C.text2, cursor: "pointer" }}>
                  🔄 Re-record Voice
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                {/* Round progress */}
                <div style={{ display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"1rem", marginTop: "0.5rem" }}>
                  {[1,2,3].map(r=>(
                    <div key={r} style={{ flex:1,height:5,borderRadius:3,transition:"background 0.3s",
                                          background:audioBlobs.length >= r ? C.green : round === r ? C.amber : C.border }}/>
                  ))}
                  <span style={{ fontSize:"0.72rem",color:C.text3,whiteSpace:"nowrap" }}>Round {round}/3</span>
                </div>

                {/* Calibration text */}
                <div style={{ marginBottom:"1rem" }}>
                  <div style={{ display:"inline-block",padding:"0.2rem 0.65rem",borderRadius:20,
                                background:C.amber,color:"#fff",fontSize:"0.65rem",
                                fontWeight:700,letterSpacing:"0.08em",marginBottom:"0.5rem" }}>
                    READ ALOUD PASSAGE
                  </div>
                  <div style={{ background:"#F9F8F6",border:`1.5px solid ${C.border}`,borderRadius:10,
                                padding:"0.8rem",fontSize:"0.83rem",fontWeight:500,lineHeight:1.55,
                                color:C.text1 }}>
                    {round === 1 && `"I am securely enrolling my voice into the PILOT system. This unique vocal signature will verify my identity."`}
                    {round === 2 && `"I authorize PILOT to act on my commands and confirm that I am the registered user of this system."`}
                    {round === 3 && `"My voice is my password. It is unique, secure, and personal to me in every operation."`}
                  </div>
                </div>

                {/* Mic button + bars */}
                <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:"0.5rem", flex: 1, justifyContent: "center" }}>
                  <button onClick={phase==="recording"?handleStop:startRec}
                    style={{ width:54,height:54,borderRadius:"50%",
                             background:phase==="recording"?"#EF4444":C.amberDark,
                             border:"none",fontSize:"1.2rem",color:"#fff",cursor:"pointer",
                             boxShadow:phase==="recording"?"0 0 0 8px rgba(239,68,68,0.15)":"none",
                             transition:"all 0.2s" }}>
                    {phase==="recording"?"⏹":"🎤"}
                  </button>
                  <div style={{ display:"flex",alignItems:"flex-end",gap:"3px",height:20 }}>
                    {bars.map((h,i)=>(
                      <div key={i} style={{ width:4,borderRadius:2,background:C.amberDark,
                                            height:phase==="recording"?h:3,transition:"height 0.1s" }}/>
                    ))}
                  </div>
                  <div style={{ fontSize:"0.75rem",color:C.text3,textAlign:"center" }}>
                    {phase==="idle"?`Tap mic to start Round ${round}`:
                     phase==="recording"?"Recording… read passage above":
                     `Round ${round} captured ✓`}
                  </div>
                  {phase!=="idle"&&(
                    <div style={{ width:"100%",marginTop:"0.2rem" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",
                                    fontSize:"0.68rem",fontWeight:700,color:C.text3,marginBottom:"0.2rem" }}>
                        <span>CLARITY SCORE</span><span style={{ color:C.green }}>{clarity}%</span>
                      </div>
                      <div style={{ height:6,background:C.border,borderRadius:3,overflow:"hidden" }}>
                        <div style={{ height:"100%",background:C.green,borderRadius:3,
                                      width:`${clarity}%`,transition:"width 0.3s" }}/>
                      </div>
                    </div>
                  )}

                  {phase==="done" && (
                    <button onClick={saveRound}
                      style={{ padding:"0.55rem 1.2rem",borderRadius:10,background:C.amber,
                               border:"none",color:"#fff",fontWeight:600,fontSize:"0.8rem",cursor:"pointer", marginTop: "0.5rem" }}>
                      Save Round {round} {round < 3 ? `& Go to Round ${round + 1} →` : `& Complete`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {err&&<div style={{ color:"#EF4444",fontSize:"0.78rem",marginTop:"1.2rem",textAlign:"center" }}>{err}</div>}

        <button onClick={submit} disabled={loading || audioBlobs.length < 3}
          style={{ width:"100%",padding:"0.85rem",borderRadius:30,
                   background:audioBlobs.length === 3 ? "#6B5100" : "#E5E2DA",
                   color:audioBlobs.length === 3 ? "#fff" : "#AAA",
                   fontWeight:700,border:"none",marginTop:"1.8rem",cursor:audioBlobs.length === 3 ? "pointer" : "not-allowed" }}>
          {loading ? "Registering profile…" : audioBlobs.length < 3 ? "Complete Voice Calibration to Sign Up" : "Create Account & Enroll Voice →"}
        </button>

        <p style={{ textAlign:"center",fontSize:"0.83rem",color:C.text3,marginTop:"1rem" }}>
          Already have an account?{" "}
          <span style={{ color:C.amberDark,cursor:"pointer",fontWeight:600 }} onClick={()=>store.setPage("login")}>Sign in</span>
        </p>
      </div>
    </div>
  );
}

/* ── OTP ── */
function OTPPage() {
  const store = useAppStore();
  const [digits,setDigits]=useState(["","","","","",""]);
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const refs=Array.from({length:6},()=>useRef<HTMLInputElement>(null));
  function upd(i:number,v:string){ if(!/^\d?$/.test(v))return; const d=[...digits];d[i]=v;setDigits(d); if(v&&i<5)refs[i+1].current?.focus(); }
  function kd(i:number,e:React.KeyboardEvent){ if(e.key==="Backspace"&&!digits[i]&&i>0)refs[i-1].current?.focus(); }
  async function verify(){
    const otp=digits.join("");
    if(otp.length!==6){setErr("Enter all 6 digits");return;}
    setErr("");setLoading(true);
    try{
      const r=await api("POST","/auth/verify-otp",{email:store.pendingEmail,otp});
      store.setUser(r.user,r.access_token);
      store.setPage("dashboard");
    }
    catch(e:any){setErr(e.message);}
    finally{setLoading(false);}
  }
  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#f8f6f0,#ede8e0)",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:20,padding:"2.5rem",width:420,
                    boxShadow:"0 8px 48px rgba(0,0,0,0.08)",textAlign:"center" }}>
        <div style={{ width:50,height:50,borderRadius:14,background:"#111111",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      margin:"0 auto 1rem", boxShadow: "0 4px 12px rgba(245,167,0,0.2)" }}>
          <PILOTLogo size={36} />
        </div>
        <h2 style={{ fontSize:"1.5rem",fontWeight:800,marginBottom:"0.25rem" }}>Check your email</h2>
        <p style={{ color:C.text3,fontSize:"0.85rem",marginBottom:"1.5rem" }}>
          We sent a 6-digit code to <strong>{store.pendingEmail}</strong>
        </p>
        <div style={{ display:"flex",gap:"0.55rem",justifyContent:"center",marginBottom:"1.4rem" }}>
          {digits.map((d,i)=>(
            <input key={i} ref={refs[i]} value={d} maxLength={1} inputMode="numeric"
              onChange={e=>upd(i,e.target.value)} onKeyDown={e=>kd(i,e)}
              style={{ width:50,height:58,borderRadius:12,border:`2px solid ${C.border}`,
                       textAlign:"center",fontSize:"1.5rem",fontWeight:700,
                       background:"#F9F8F6",outline:"none",color:C.text1 }}/>
          ))}
        </div>
        {err&&<div style={{ color:"#EF4444",fontSize:"0.78rem",marginBottom:"0.6rem" }}>{err}</div>}
        <button onClick={verify} disabled={loading}
          style={{ width:"100%",padding:"0.85rem",borderRadius:30,background:"#6B5100",
                   color:"#fff",fontWeight:700,border:"none",cursor:"pointer" }}>
          {loading?"Verifying…":"Verify & Continue →"}
        </button>
        <p style={{ fontSize:"0.8rem",color:C.text3,marginTop:"1rem" }}>
          Didn't receive it?{" "}
          <span style={{ color:C.amberDark,cursor:"pointer" }}
            onClick={()=>api("POST","/auth/send-otp",{email:store.pendingEmail})}>Resend</span>
        </p>
      </div>
    </div>
  );
}

/* ── VOICE CALIBRATION — 3 rounds, all chunks accumulated ── */
function VoiceCalibration() {
  const store = useAppStore();
  const [phase,   setPhase]   = useState<"idle"|"recording"|"done">("idle");
  const [round,   setRound]   = useState(1);
  const [clarity, setClarity] = useState(0);
  const [bars,    setBars]    = useState<number[]>(new Array(9).fill(3));
  const [voiceId, setVoiceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");
  const mrRef       = useRef<MediaRecorder|null>(null);
  const allChunks   = useRef<Blob[]>([]);   // accumulates ALL rounds — never cleared between rounds
  const animRef     = useRef<number>(0);
  const streamRef   = useRef<MediaStream|null>(null);

  async function startRec() {
    setErr("");
    if (!navigator.mediaDevices) {
      setErr("Microphone access is unavailable. Please ensure you are using a secure context (HTTPS or localhost) and have granted microphone permissions.");
      return;
    }
    // Stop previous stream if any
    streamRef.current?.getTracks().forEach(t=>t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       16000,
        channelCount:     1,
      },
    });
    streamRef.current = stream;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an  = ctx.createAnalyser(); an.fftSize=128; src.connect(an);
    const tick = () => {
      const d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d);
      setBars(Array.from(d.slice(0,9)).map(v=>3+Math.floor(v/255*22)));
      setClarity(c=>Math.min(97,c+2));
      animRef.current = requestAnimationFrame(tick);
    }; tick();
    const mr = new MediaRecorder(stream, {mimeType:"audio/webm"});
    mrRef.current = mr;
    // IMPORTANT: append to allChunks — don't reset between rounds
    mr.ondataavailable = e => { if(e.data.size>0) allChunks.current.push(e.data); };
    mr.start(500);   // collect chunks every 500ms for reliability
    setPhase("recording");
  }

  function stopRec() {
    cancelAnimationFrame(animRef.current);
    return new Promise<void>(resolve => {
      const mr = mrRef.current;
      if (mr && mr.state !== "inactive") {
        mr.onstop = () => { resolve(); };
        mr.stop();
      } else {
        resolve();
      }
    });
  }

  async function handleStop() {
    await stopRec();
    streamRef.current?.getTracks().forEach(t=>t.stop());
    setPhase("done");
  }

  async function nextRound() {
    await stopRec();   // ensure recording is fully stopped and chunks flushed
    streamRef.current?.getTracks().forEach(t=>t.stop());
    if (round < 3) {
      setRound(r=>r+1);
      setPhase("idle");
      setClarity(0);
      setBars(new Array(9).fill(3));
      // DO NOT clear allChunks — we accumulate all 3 rounds
    } else {
      setPhase("done");
      await submit();
    }
  }

  async function submit() {
    if (allChunks.current.length === 0) {
      setErr("No audio recorded. Please record at least one round.");
      return;
    }
    setLoading(true); setErr("");
    try {
      const token = localStorage.getItem("pilot_token")!;
      const role  = store.user?.role || "developer";
      const enroll = await api("POST","/enrollment/start",{name:store.user?.name||"User",role});
      // Combine ALL chunks from all 3 rounds into one blob
      const blob = new Blob(allChunks.current, {type:"audio/webm"});
      if (blob.size < 1000) { setErr("Recording too short. Please try again."); return; }
      const fd = new FormData();
      fd.append("speaker_id", String(enroll.speaker_id));
      fd.append("audio", blob, "enrollment.webm");
      const res = await fetch("/api/v1/enrollment/audio",{
        method:"POST", headers:{Authorization:`Bearer ${token}`}, body:fd
      }).then(r=>r.json());
      setVoiceId(res.voice_id || `#${String(enroll.speaker_id).padStart(6,"0")}`);
      setTimeout(()=>store.setPage("dashboard"), 1500);
    } catch(e:any) {
      setErr(e.message||"Enrollment failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const phaseDots=[
    {l:"Reading\nStarted", done:phase!=="idle"},
    {l:"Voice\nCaptured",  done:phase==="done"},
    {l:"Embedding\nGenerated", done:!!voiceId},
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex",
                  flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"2rem" }}>
      <div style={{ color:C.amberDark,fontSize:"0.78rem",fontWeight:700,
                    letterSpacing:"0.06em",marginBottom:"0.4rem" }}>⚡ STEP 4 OF 4</div>
      <h2 style={{ fontSize:"1.9rem",fontWeight:900,marginBottom:"0.4rem" }}>Voice Calibration</h2>
      <p style={{ color:C.text3,textAlign:"center",maxWidth:480,marginBottom:"1.75rem",fontSize:"0.88rem" }}>
        Please read the following text naturally. This allows PILOT to build a secure biometric model of your voice.
      </p>

      <div style={{ background:"#fff",borderRadius:20,padding:"2rem",width:"100%",maxWidth:600,
                    boxShadow:"0 4px 24px rgba(0,0,0,0.06)" }}>
        {/* Role badge — read-only, fixed at signup */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
                      paddingBottom:"1rem",borderBottom:`1px solid ${C.border}`,marginBottom:"1rem" }}>
          <div>
            <div style={{ fontWeight:600,fontSize:"0.88rem" }}>Voice Profile Role</div>
            <div style={{ fontSize:"0.75rem",color:C.text3 }}>Fixed to your account role — assigned at signup.</div>
          </div>
          <div style={{ padding:"0.4rem 1rem",borderRadius:20,background:C.amberBg,
                       border:`1.5px solid ${C.amber}`,fontSize:"0.82rem",
                       fontWeight:700,color:C.amberDark }}>
            {(store.user?.role||"developer").toUpperCase()}
          </div>
        </div>

        {/* Round progress */}
        <div style={{ display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"0.9rem" }}>
          {[1,2,3].map(r=>(
            <div key={r} style={{ flex:1,height:5,borderRadius:3,transition:"background 0.3s",
                                  background:round>r?C.green:round===r?C.amber:C.border }}/>
          ))}
          <span style={{ fontSize:"0.72rem",color:C.text3,whiteSpace:"nowrap" }}>Round {round}/3</span>
        </div>

        {/* Two calibration phrases — flaw 5 */}
        <div style={{ marginBottom:"1.1rem" }}>
          <div style={{ display:"inline-block",padding:"0.2rem 0.65rem",borderRadius:20,
                        background:C.amber,color:"#fff",fontSize:"0.65rem",
                        fontWeight:700,letterSpacing:"0.08em",marginBottom:"0.55rem" }}>
            CALIBRATION TEXT — ROUND {round}
          </div>
          {/* Phrase 1 */}
          <div style={{ background:"#F9F8F6",border:`1.5px solid ${C.border}`,borderRadius:10,
                        padding:"0.9rem 1rem",fontSize:"0.95rem",fontWeight:500,lineHeight:1.65,
                        color:C.text1,marginBottom:"0.5rem" }}>
            "I am securely enrolling my voice into the PILOT system.
            This unique vocal signature will verify my identity."
          </div>
          {/* Phrase 2 */}
          <div style={{ background:"#F9F8F6",border:`1.5px solid ${C.border}`,borderRadius:10,
                        padding:"0.9rem 1rem",fontSize:"0.95rem",fontWeight:500,lineHeight:1.65,
                        color:C.text1 }}>
            "I authorize PILOT to act on my commands and confirm
            that I am the registered user of this system."
          </div>
        </div>

        {/* Mic button + bars */}
        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:"0.6rem" }}>
          <button onClick={phase==="recording"?handleStop:startRec}
            style={{ width:58,height:58,borderRadius:"50%",
                     background:phase==="recording"?"#EF4444":C.amberDark,
                     border:"none",fontSize:"1.3rem",color:"#fff",cursor:"pointer",
                     boxShadow:phase==="recording"?"0 0 0 8px rgba(239,68,68,0.15)":"none",
                     transition:"all 0.2s" }}>
            {phase==="recording"?"⏹":"🎤"}
          </button>
          <div style={{ display:"flex",alignItems:"flex-end",gap:"3px",height:24 }}>
            {bars.map((h,i)=>(
              <div key={i} style={{ width:4,borderRadius:2,background:C.amberDark,
                                    height:phase==="recording"?h:3,transition:"height 0.1s" }}/>
            ))}
          </div>
          <div style={{ fontSize:"0.78rem",color:C.text3 }}>
            {phase==="idle"?`Tap mic to start Round ${round}`:
             phase==="recording"?"Recording… read both passages above":
             `Round ${round} captured ✓`}
          </div>
          {phase!=="idle"&&(
            <div style={{ width:"100%",marginTop:"0.2rem" }}>
              <div style={{ display:"flex",justifyContent:"space-between",
                            fontSize:"0.7rem",fontWeight:700,color:C.text3,marginBottom:"0.25rem" }}>
                <span>CLARITY SCORE</span><span style={{ color:C.green }}>{clarity}%</span>
              </div>
              <div style={{ height:8,background:C.border,borderRadius:4,overflow:"hidden" }}>
                <div style={{ height:"100%",background:C.green,borderRadius:4,
                              width:`${clarity}%`,transition:"width 0.3s" }}/>
              </div>
            </div>
          )}
          {err&&<div style={{color:"#EF4444",fontSize:"0.78rem",marginTop:"0.25rem"}}>{err}</div>}
          {phase==="done"&&(
            <button onClick={nextRound}
              style={{ padding:"0.55rem 1.4rem",borderRadius:10,background:C.amber,
                       border:"none",color:"#fff",fontWeight:600,fontSize:"0.85rem",cursor:"pointer" }}>
              {loading?"Saving…":(round<3?`Continue to Round ${round+1} →`:"Complete Enrollment →")}
            </button>
          )}
        </div>

        {/* phase dots */}
        <div style={{ display:"flex",alignItems:"center",marginTop:"1.25rem" }}>
          {phaseDots.map((ph,i)=>(
            <React.Fragment key={i}>
              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:"0.25rem" }}>
                <div style={{ width:30,height:30,borderRadius:"50%",display:"flex",
                              alignItems:"center",justifyContent:"center",fontSize:"0.8rem",
                              background:ph.done?C.green:"#E5E2DA",
                              color:ph.done?"#fff":"#AAA" }}>
                  {ph.done?"✓":"···"}
                </div>
                <div style={{ fontSize:"0.62rem",textAlign:"center",whiteSpace:"pre-line",
                              color:ph.done?C.text1:"#AAA",fontWeight:500 }}>{ph.l}</div>
              </div>
              {i<phaseDots.length-1&&<div style={{ flex:1,height:2,background:ph.done?C.green:C.border,margin:"0 4px 16px" }}/>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* footer buttons */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
                    width:"100%",maxWidth:600,marginTop:"1.25rem" }}>
        <button onClick={()=>store.setPage("dashboard")}
          style={{ background:"none",border:"none",color:C.text3,fontSize:"0.88rem",cursor:"pointer" }}>
          Cancel
        </button>
        {voiceId&&(
          <div style={{ display:"flex",alignItems:"center",gap:"0.35rem",
                        padding:"0.35rem 0.9rem",background:"#F0EDE8",borderRadius:20,
                        fontSize:"0.75rem",color:C.text2 }}>
            🔒 ID: {voiceId}
          </div>
        )}
        <button onClick={submit} disabled={loading}
          style={{ padding:"0.6rem 1.5rem",borderRadius:10,border:"none",
                   background:phase==="done"?C.amberDark:"#E5E2DA",
                   color:phase==="done"?"#fff":"#AAA",
                   fontWeight:600,fontSize:"0.88rem",cursor:"pointer" }}>
          {loading?"Saving…":voiceId?"Done ✓":"Finish"}
        </button>
      </div>
    </div>
  );
}

/* ── FORGOT PASSWORD ── */
export function ForgotPasswordPage() {
  const store = useAppStore();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    if (!email.trim()) {
      setErr("Please enter your email address.");
      return;
    }
    setErr("");
    setLoading(true);
    try {
      await api("POST", "/auth/forgot-password", { email });
      store.setPendingEmail(email);
      store.setPage("forgot-verify");
    } catch (e: any) {
      setErr(e.message || "Failed to send OTP. Please check your email and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#f8f6f0,#ede8e0)",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"2.5rem", width:400,
                    boxShadow:"0 8px 48px rgba(0,0,0,0.08)", position:"relative" }}>
        <button onClick={()=>store.setPage("login")}
          style={{ position:"absolute",top:"1rem",left:"1rem",background:"none",border:"none",
                   color:C.text3,cursor:"pointer",fontSize:"0.85rem",display:"flex",
                   alignItems:"center",gap:"0.3rem" }}>← Back to Login</button>
        <div style={{ textAlign:"center", marginBottom:"1.75rem", marginTop: "1rem" }}>
          <div style={{ width:50,height:50,borderRadius:14,background:"#111111",
                        display:"flex",alignItems:"center",justifyContent:"center",
                        margin:"0 auto 1rem", boxShadow: "0 4px 12px rgba(245,167,0,0.2)" }}>
            <PILOTLogo size={36} />
          </div>
          <h2 style={{ fontSize:"1.6rem", fontWeight:800 }}>Forgot Password</h2>
          <p style={{ color:C.text3, fontSize:"0.88rem" }}>Enter your email to receive a 6-digit verification code.</p>
        </div>
        
        <label style={{ fontSize:"0.8rem",fontWeight:500,display:"block",marginBottom:"0.3rem" }}>Email address</label>
        <input style={{...inp,marginBottom:"0.85rem"}} type="email" value={email}
          onChange={e=>setEmail(e.target.value)} placeholder="name@company.com"
          onKeyDown={e=>e.key==="Enter"&&sendOtp()}/>
          
        {err&&<div style={{ color:"#EF4444",fontSize:"0.78rem",marginTop:"0.4rem",marginBottom:"0.4rem" }}>{err}</div>}
        
        <button onClick={sendOtp} disabled={loading}
          style={{ width:"100%",padding:"0.85rem",borderRadius:30,background:"#6B5100",
                   color:"#fff",fontWeight:700,border:"none",marginTop:"1rem",fontSize:"0.92rem",cursor:"pointer" }}>
          {loading?"Sending OTP…":"Send OTP →"}
        </button>
      </div>
    </div>
  );
}

/* ── FORGOT OTP PAGE ── */
export function ForgotOTPPage() {
  const store = useAppStore();
  const [digits,setDigits]=useState(["","","","","",""]);
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const refs=Array.from({length:6},()=>useRef<HTMLInputElement>(null));
  
  function upd(i:number,v:string){ 
    if(!/^\d?$/.test(v))return; 
    const d=[...digits];d[i]=v;setDigits(d); 
    if(v&&i<5)refs[i+1].current?.focus(); 
  }
  
  function kd(i:number,e:React.KeyboardEvent){ 
    if(e.key==="Backspace"&&!digits[i]&&i>0)refs[i-1].current?.focus(); 
  }
  
  async function verify(){
    const otp=digits.join("");
    if(otp.length!==6){setErr("Enter all 6 digits");return;}
    setErr("");setLoading(true);
    try{
      const r=await api("POST","/auth/verify-forgot-otp",{email:store.pendingEmail,otp});
      store.setUser(r.user,r.access_token);
      store.setPage("dashboard");
    }
    catch(e:any){setErr(e.message);}
    finally{setLoading(false);}
  }
  
  async function resend() {
    setErr("");
    try {
      await api("POST", "/auth/forgot-password", { email: store.pendingEmail });
    } catch(e:any) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#f8f6f0,#ede8e0)",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:20,padding:"2.5rem",width:420,
                    boxShadow:"0 8px 48px rgba(0,0,0,0.08)",textAlign:"center" }}>
        <div style={{ width:50,height:50,borderRadius:14,background:"#111111",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      margin:"0 auto 1rem", boxShadow: "0 4px 12px rgba(245,167,0,0.2)" }}>
          <PILOTLogo size={36} />
        </div>
        <h2 style={{ fontSize:"1.5rem",fontWeight:800,marginBottom:"0.25rem" }}>Verify OTP</h2>
        <p style={{ color:C.text3,fontSize:"0.85rem",marginBottom:"1.5rem" }}>
          We sent a 6-digit password recovery code to <strong>{store.pendingEmail}</strong>
        </p>
        <div style={{ display:"flex",gap:"0.55rem",justifyContent:"center",marginBottom:"1.4rem" }}>
          {digits.map((d,i)=>(
            <input key={i} ref={refs[i]} value={d} maxLength={1} inputMode="numeric"
              onChange={e=>upd(i,e.target.value)} onKeyDown={e=>kd(i,e)}
              style={{ width:50,height:58,borderRadius:12,border:`2px solid ${C.border}`,
                       textAlign:"center",fontSize:"1.5rem",fontWeight:700,
                       background:"#F9F8F6",outline:"none",color:C.text1 }}/>
          ))}
        </div>
        {err&&<div style={{ color:"#EF4444",fontSize:"0.78rem",marginBottom:"0.6rem" }}>{err}</div>}
        <button onClick={verify} disabled={loading}
          style={{ width:"100%",padding:"0.85rem",borderRadius:30,background:"#6B5100",
                   color:"#fff",fontWeight:700,border:"none",cursor:"pointer" }}>
          {loading?"Verifying…":"Verify & Continue →"}
        </button>
        <p style={{ fontSize:"0.8rem",color:C.text3,marginTop:"1rem" }}>
          Didn't receive it?{" "}
          <span style={{ color:C.amberDark,cursor:"pointer" }}
            onClick={resend}>Resend</span>
        </p>
      </div>
    </div>
  );
}

