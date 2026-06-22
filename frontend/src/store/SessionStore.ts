import { create } from "zustand";

export type AppPage = "landing"|"login"|"signup"|"verify"|"enroll"|"dashboard"|"ppt"|"care"|"email"|"jira"|"profile"|"settings"|"forgot"|"forgot-verify";

export interface TranscriptEntry {
  text:string; speaker:string|null; role:string|null; confidence:number; timestamp:number;
}
export interface ToolCard {
  job_id:string; tool:string; status:string; speaker?:string; result?:unknown; latency_ms?:number;
}
export interface JobItem {
  job_id:string; tool:string; status:string; requester?:string; mode?:string;
}
export interface Speaker { id:number; name:string; role:string; }
export interface SlideShape { text:string; color:string; size:number; bold:boolean; left?:number; top?:number; width?:number; align?:string; }
export interface SlideInfo { index:number; title:string; notes:string; bg_color?:string; shapes?:SlideShape[]; }

type Theme = "light" | "dark";

interface AppState {
  page:          AppPage;
  theme:         Theme;
  user:          {id:number;name:string;email:string;role:string}|null;
  token:         string|null;
  sessionId:     string|null;
  usecase:       string;
  transcripts:   TranscriptEntry[];
  toolCards:     ToolCard[];
  jobQueue:      JobItem[];
  speakers:      Speaker[];
  confirmPrompt: {tool:string;speaker:string;message:string}|null;
  pendingEmail:  string;
  pptSlides:     SlideInfo[];
  pptUploaded:   boolean;
  pptFileName:   string;
  
  // Real-time typed flight inputs to sync with the background voice assistant
  typedFlightOrigin: string;
  typedFlightDestination: string;
  typedFlightDate: string;
  setTypedFlightContext: (origin: string, dest: string, date: string) => void;
  
  // Globally shared persistent listening state to prevent mic resets on page switch
  isListeningGlobal: boolean;
  setIsListeningGlobal: (l: boolean) => void;

  setPage:         (p:AppPage|string)=>void;
  setTheme:        (t:Theme)=>void;
  setUser:         (u:AppState["user"],token:string)=>void;
  setSession:      (id:string)=>void;
  addTranscript:   (e:TranscriptEntry)=>void;
  upsertToolCard:  (c:Partial<ToolCard>&{job_id:string})=>void;
  addJob:          (j:JobItem)=>void;
  setSpeakers:     (s:Speaker[])=>void;
  setConfirm:      (p:AppState["confirmPrompt"])=>void;
  setPendingEmail: (e:string)=>void;
  setPptSlides:    (s:SlideInfo[])=>void;
  setPptFileName:  (n:string)=>void;
  logout:          ()=>void;
}

const savedTheme = (localStorage.getItem("pilot_theme") || "light") as Theme;
const savedPage = (localStorage.getItem("pilot_page") || "landing") as AppPage;
const savedPendingEmail = localStorage.getItem("pilot_pending_email") || "";

export const useAppStore = create<AppState>((set)=>({
  page: savedPage,
  theme: savedTheme,
  user: (()=>{try{return JSON.parse(localStorage.getItem("pilot_user")||"null");}catch{return null;}})(),
  token: localStorage.getItem("pilot_token"),
  sessionId: null,
  usecase: "customercare",
  transcripts: [],
  toolCards: [],
  jobQueue: [],
  speakers: [],
  confirmPrompt: null,
  pendingEmail: savedPendingEmail,
  pptSlides: [],
  pptUploaded: false,
  pptFileName: "",
  
  typedFlightOrigin: "",
  typedFlightDestination: "",
  typedFlightDate: "",
  setTypedFlightContext: (origin, dest, date) => set({
    typedFlightOrigin: origin,
    typedFlightDestination: dest,
    typedFlightDate: date
  }),
  
  isListeningGlobal: false,
  setIsListeningGlobal: (l) => set({ isListeningGlobal: l }),

  setPage:    (p)=>{ localStorage.setItem("pilot_page", p); set({page:p as AppPage}); },
  setTheme:   (t)=>{ localStorage.setItem("pilot_theme",t); set({theme:t}); },
  setUser:    (u,t)=>{ localStorage.setItem("pilot_token",t); localStorage.setItem("pilot_user",JSON.stringify(u)); set({user:u,token:t}); },
  setSession: (id)=>set({sessionId:id}),
  addTranscript:  (e)=>set(s=>({transcripts:[...s.transcripts.slice(-299),e]})),
  upsertToolCard: (c)=>set(s=>{
    const idx=s.toolCards.findIndex(x=>x.job_id===c.job_id);
    if(idx>=0){const a=[...s.toolCards];a[idx]={...a[idx],...c};return{toolCards:a};}
    return{toolCards:[...s.toolCards,c as ToolCard]};
  }),
  addJob:      (j)=>set(s=>({jobQueue:[...s.jobQueue,j]})),
  setSpeakers: (sp)=>set({speakers:sp}),
  setConfirm:  (p)=>set({confirmPrompt:p}),
  setPendingEmail:(e)=>{ localStorage.setItem("pilot_pending_email", e); set({pendingEmail:e}); },
  setPptSlides:(s)=>set({pptSlides:s, pptUploaded:s.length>0}),
  setPptFileName:(n)=>set({pptFileName:n}),
  logout:()=>{
    localStorage.removeItem("pilot_token"); localStorage.removeItem("pilot_user");
    localStorage.removeItem("pilot_page"); localStorage.removeItem("pilot_pending_email");
    set({user:null,token:null,sessionId:null,page:"landing",transcripts:[],toolCards:[],jobQueue:[]});
  },
}));
