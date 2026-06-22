/**
 * Flight search / booking UI panel.
 * FSE-B owns this.
 */
import React, { useState } from "react";
import { useAppStore } from "../store/SessionStore";

interface Flight { id: string; origin: string; destination: string; date: string; departure: string; price: number; seats: number; }

export function FlightView() {
  const store = useAppStore();
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  const [date, setDate] = useState("");
  const [results, setResults] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/flights/search", {
        method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${store.token}`},
        body: JSON.stringify({ origin, destination: dest, date })
      }).then(r => r.json());
      setResults(r.flights ?? []);
    } finally { setLoading(false); }
  }

  return (
    <div style={{ padding:"1rem", color:"#E8E8F0" }}>
      <div style={{ marginBottom:"1rem" }}>
        <input value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="Origin (JFK)"
          style={{ width:"100%", marginBottom:"0.5rem", padding:"0.6rem 0.8rem", background:"#1A1A26",
                   border:"1px solid rgba(108,99,255,0.15)", borderRadius:8, color:"#E8E8F0", fontSize:"0.85rem" }}/>
        <input value={dest} onChange={e=>setDest(e.target.value)} placeholder="Destination (LAX)"
          style={{ width:"100%", marginBottom:"0.5rem", padding:"0.6rem 0.8rem", background:"#1A1A26",
                   border:"1px solid rgba(108,99,255,0.15)", borderRadius:8, color:"#E8E8F0", fontSize:"0.85rem" }}/>
        <input value={date} onChange={e=>setDate(e.target.value)} placeholder="Date (2026-07-01)"
          style={{ width:"100%", marginBottom:"0.75rem", padding:"0.6rem 0.8rem", background:"#1A1A26",
                   border:"1px solid rgba(108,99,255,0.15)", borderRadius:8, color:"#E8E8F0", fontSize:"0.85rem" }}/>
        <button onClick={search} disabled={loading}
          style={{ width:"100%", padding:"0.6rem", background:"#6C63FF", border:"none",
                   borderRadius:8, color:"#fff", cursor:"pointer", fontWeight:500 }}>
          {loading ? "Searching..." : "Search Flights"}
        </button>
      </div>
      {results.map(f => (
        <div key={f.id} style={{ background:"#1E1E2E", border:"1px solid rgba(108,99,255,0.15)",
                                  borderRadius:10, padding:"1rem", marginBottom:"0.5rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", marginBottom:"0.4rem" }}>
            <span style={{ fontWeight:600, fontFamily:"'Syne',sans-serif", fontSize:"1rem" }}>{f.origin}</span>
            <span style={{ color:"#555570", fontSize:"0.8rem" }}>→</span>
            <span style={{ fontWeight:600, fontFamily:"'Syne',sans-serif", fontSize:"1rem" }}>{f.destination}</span>
            <span style={{ marginLeft:"auto", fontFamily:"monospace", color:"#00FFB2", fontWeight:600 }}>${f.price}</span>
          </div>
          <div style={{ fontSize:"0.8rem", color:"#8888AA" }}>{f.departure} → {f.price && f.seats + " seats"}</div>
        </div>
      ))}
    </div>
  );
}
