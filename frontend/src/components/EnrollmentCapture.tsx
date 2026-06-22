/**
 * EnrollmentCapture — 3-step signup + voice recording.
 * FSE-B owns this.
 */
import React, { useState, useRef } from "react";
import { useAppStore } from "../store/SessionStore";

const ENROLLMENT_PASSAGE = `"The quick brown fox jumps over the lazy dog. I am setting up my voice profile for PILOT. My name is enrolled in the system and I authorize my voice identity for speaker recognition and role-based access control."`;

export function EnrollmentCapture({ onDone }: { onDone: () => void }) {
  const store = useAppStore();
  const [recording, setRecording]   = useState(false);
  const [hasAudio,  setHasAudio]    = useState(false);
  const [status,    setStatus]      = useState("Ready to record");
  const chunksRef = useRef<Blob[]>([]);
  const mrRef     = useRef<MediaRecorder | null>(null);

  async function toggleRecord() {
    if (recording) {
      mrRef.current?.stop();
      setRecording(false);
      setStatus("Recording saved ✓");
      setHasAudio(true);
      return;
    }
    chunksRef.current = [];
    if (!navigator.mediaDevices) {
      setStatus("Error: Insecure context (Mic requires HTTPS or localhost)");
      return;
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
    const mr = new MediaRecorder(stream);
    mrRef.current = mr;
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.start();
    setRecording(true);
    setStatus("Recording… read the passage above");
  }

  async function submit() {
    if (!chunksRef.current.length) return;
    setStatus("Uploading…");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const enroll = await fetch("/api/v1/enrollment/start", {
        method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${store.token}`},
        body: JSON.stringify({ name: store.user?.name ?? "User", role: store.user?.role ?? "developer" })
      }).then(r => r.json());
      const fd = new FormData();
      fd.append("speaker_id", String(enroll.speaker_id));
      fd.append("audio", blob, "enrollment.webm");
      await fetch("/api/v1/enrollment/audio", {
        method:"POST", headers:{ Authorization:`Bearer ${store.token}` }, body: fd
      });
      setStatus("Enrolled ✓");
      onDone();
    } catch (e) {
      setStatus(`Failed: ${e}`);
    }
  }

  return (
    <div style={{ textAlign:"center", padding:"1rem" }}>
      <div style={{ fontSize:"2rem", marginBottom:"0.75rem" }}>🎤</div>
      <h3 style={{ marginBottom:"0.5rem" }}>Voice Enrollment</h3>
      <p style={{ fontSize:"0.82rem", color:"#8888AA", marginBottom:"1.5rem" }}>
        Read the passage clearly to create your voice fingerprint.
      </p>
      <div style={{ background:"#1A1A26", border:"1px solid rgba(108,99,255,0.15)", borderRadius:10,
                    padding:"1rem", fontSize:"0.85rem", lineHeight:1.7, color:"#8888AA",
                    textAlign:"left", marginBottom:"1.5rem" }}>
        {ENROLLMENT_PASSAGE}
      </div>
      <div style={{ fontSize:"0.8rem", color:"#555570", marginBottom:"1rem" }}>{status}</div>
      <div style={{ display:"flex", gap:"0.75rem", justifyContent:"center" }}>
        <button onClick={toggleRecord}
          style={{ padding:"0.5rem 1.2rem", borderRadius:8, border:"1px solid rgba(108,99,255,0.3)",
                   background: recording ? "rgba(255,68,102,0.15)" : "transparent",
                   color: recording ? "#FF4466" : "#8888AA", cursor:"pointer" }}>
          {recording ? "⏹ Stop" : "🎙 Record"}
        </button>
        <button onClick={submit} disabled={!hasAudio}
          style={{ padding:"0.5rem 1.2rem", borderRadius:8, border:"none",
                   background: hasAudio ? "#6C63FF" : "#1A1A26",
                   color: hasAudio ? "#fff" : "#555570", cursor: hasAudio ? "pointer" : "not-allowed" }}>
          Submit
        </button>
      </div>
      <button onClick={onDone} style={{ marginTop:"1rem", background:"none", border:"none", color:"#555570", cursor:"pointer", fontSize:"0.8rem" }}>
        Skip for now
      </button>
    </div>
  );
}
