import React from "react";
import { useAppStore } from "./store/SessionStore";
import { LandingPage } from "./components/SessionHeader";
import { Dashboard }   from "./components/TranscriptOverlay";
import "./global.css";

export default function App() {
  const page = useAppStore((s) => s.page);

  React.useEffect(() => {
    const token = localStorage.getItem("pilot_token");
    const user  = localStorage.getItem("pilot_user");
    if (token && user) {
      try {
        useAppStore.getState().setUser(JSON.parse(user), token);
        // Stay on landing — don't auto-redirect
      } catch { /* ignore */ }
    }
  }, []);

  const dashPages = ["dashboard","ppt","care","email","jira","profile","settings"];
  if (dashPages.includes(page)) return <Dashboard />;
  return <LandingPage />;
}
