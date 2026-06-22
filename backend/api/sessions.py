from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from db.engine import get_db
from db.models import Session as PilotSession
import uuid

router = APIRouter()


class CreateSessionReq(BaseModel):
    usecase: str  # ppt | customercare


@router.post("")
async def create(req: CreateSessionReq, db: AsyncSession = Depends(get_db)):
    sid = str(uuid.uuid4())
    db.add(PilotSession(session_id=sid, usecase=req.usecase, user_id=None))
    await db.commit()
    from core.session_manager import session_manager
    session_manager.register(sid, 0, req.usecase)
    return {"session_id": sid, "usecase": req.usecase, "state": "IDLE"}


@router.get("/list")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import desc
    # Return only the top 6 most recent sessions ordered chronologically by ID to prevent dashboard clutter
    result = await db.execute(
        select(PilotSession).order_by(desc(PilotSession.id)).limit(6)
    )
    rows = result.scalars().all()
    return {"sessions": [
        {"session_id": s.session_id, "usecase": s.usecase,
         "state": s.state, "created_at": str(s.created_at),
         "summary": s.summary, "bullets": s.bullets}
        for s in rows
    ]}


@router.get("/{session_id}")
async def get(session_id: str, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(PilotSession).where(PilotSession.session_id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
    return {
        "session_id": s.session_id, 
        "usecase": s.usecase, 
        "state": s.state,
        "summary": s.summary,
        "bullets": s.bullets
    }

@router.get("/{session_id}/history")
async def get_history(session_id: str, db: AsyncSession = Depends(get_db)):
    from db.models import TranscriptLog, AuditLog
    s = (await db.execute(select(PilotSession).where(PilotSession.session_id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
        
    transcripts_result = await db.execute(
        select(TranscriptLog)
        .where(TranscriptLog.session_id == session_id)
        .order_by(TranscriptLog.timestamp)
    )
    transcripts = transcripts_result.scalars().all()
    
    actions_result = await db.execute(
        select(AuditLog)
        .where(AuditLog.session_id == session_id)
        .order_by(AuditLog.timestamp)
    )
    actions = actions_result.scalars().all()
    
    return {
        "session": {
            "session_id": s.session_id,
            "usecase": s.usecase,
            "state": s.state,
            "created_at": str(s.created_at),
            "summary": s.summary,
            "bullets": s.bullets
        },
        "transcripts": [
            {"speaker": t.speaker_id, "role": t.role, "text": t.text, "timestamp": t.timestamp}
            for t in transcripts
        ],
        "actions": [
            {"tool": a.tool, "decision": a.decision, "latency_ms": a.latency_ms}
            for a in actions
        ]
    }


@router.delete("/{session_id}")
async def end(session_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    import json
    
    s = (await db.execute(select(PilotSession).where(PilotSession.session_id == session_id))).scalar_one_or_none()
    if s:
        s.ended_at = datetime.utcnow()
        s.state = "ENDED"
        
        # ── AI-GENERATED CONVERSATION SUMMARY & BULLET POINTS ──
        # Generate summary and action points based on all transcript logs from this session
        from db.models import TranscriptLog
        logs_result = await db.execute(
            select(TranscriptLog)
            .where(TranscriptLog.session_id == session_id)
            .order_by(TranscriptLog.timestamp)
        )
        logs = logs_result.scalars().all()
        
        # Extract background agent task data fully without summarization (all flights prices, code, tickets, etc.)
        bg_data_blocks = []
        for log in logs:
            text = log.text
            is_bg_task = False
            # Check for code blocks
            if "```" in text:
                is_bg_task = True
            # Check for flight lists/prices
            elif any(kw in text.lower() for kw in ["akasa air", "indigo", "spicejet", "air india", "vistara", "flight option", "ticket created", "booking ref", "found", "departing"]):
                is_bg_task = True
            
            if is_bg_task and text not in bg_data_blocks:
                bg_data_blocks.append(text)

        if logs:
            # For general discussion, only pass non-background logs to the LLM to summarize
            general_discussion_logs = [
                log for log in logs 
                if not ("```" in log.text or any(kw in log.text.lower() for kw in ["akasa air", "indigo", "spicejet", "air india", "vistara", "flight option", "ticket created", "booking ref", "found", "departing"]))
            ]
            
            if general_discussion_logs:
                conversation_text = "\n".join(
                    f"{log.speaker_id or 'User'} ({log.role or 'user'}): {log.text}"
                    for log in general_discussion_logs
                )
            else:
                conversation_text = "General discussion was brief or focused entirely on background tasks."

            # Use Groq to summarize and generate action points
            try:
                from groq import AsyncGroq
                from core.config import settings
                if settings.GROQ_API_KEY:
                    client = AsyncGroq(api_key=settings.GROQ_API_KEY)
                    prompt = (
                        f"Please analyze the following conversation history and produce a JSON object with exactly two keys:\n"
                        f"1. \"summary\": A 1-2 sentence human-like cohesive summary of the session.\n"
                        f"2. \"bullets\": A list of up to 4 action items/bullet points.\n\n"
                        f"Conversation history:\n{conversation_text}\n\n"
                        f"Return ONLY valid JSON. Example output:\n"
                        f"{{\n  \"summary\": \"The user checked the CRM records and created support tickets for some issues.\",\n  \"bullets\": [\"Looked up client details\", \"Drafted ticket for issue\"]\n}}"
                    )
                    resp = await client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        messages=[
                            {"role": "system", "content": "You are a helpful analyst summarising meeting logs into structured JSON."},
                            {"role": "user", "content": prompt}
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.3
                    )
                    ai_data = json.loads(resp.choices[0].message.content.strip())
                    s.summary = ai_data.get("summary")
                    s.bullets = json.dumps(ai_data.get("bullets", []))
            except Exception as e:
                # Fallback: simple text-based summary
                s.summary = f"Session completed with {len(logs)} transcribed lines."
                s.bullets = json.dumps(["Conversation finalized successfully."])

            # Append background task details fully without summarization
            if bg_data_blocks:
                s.summary = (s.summary or "") + "\n\n### ✦ Background Task Details (Unsummarized):\n" + "\n\n".join(bg_data_blocks)
        else:
            s.summary = "No conversation occurred in this session."
            s.bullets = json.dumps([])
            
        await db.commit()
        
    from core.session_manager import session_manager
    session_manager.remove(session_id)
    return {"status": "ended"}


class DraftEmailReq(BaseModel):
    session_id: str
    from_email: str
    to_email: str
    cc_bcc: Optional[str] = None
    subject: str
    body: str


@router.post("/draft-email")
async def draft_email_route(req: DraftEmailReq):
    from core.session_state import get_state
    from tools.system_tasks import _call_text_llm
    from queues.bus import bus
    import time
    
    prompt = (
        f"Please draft a highly professional, beautifully structured email using these details:\n"
        f"From: {req.from_email}\n"
        f"To: {req.to_email}\n"
        f"Cc/Bcc: {req.cc_bcc or 'None'}\n"
        f"Subject: {req.subject}\n"
        f"Instructions / Prompt content: {req.body}\n\n"
        f"Format the draft output strictly using our professional template:\n"
        f"Email: {req.to_email}\n"
        f"Cc/Bcc: {req.cc_bcc or 'None'}\n"
        f"Subject: {req.subject}\n\n"
        f"-----------------------------------------\n"
        f"Main Section Start\n"
        f"-----------------------------------------\n\n"
        f"Dear Recipient,\n\n"
        f"<Write the formal email body precisely following instructions>\n\n"
        f"Best regards,\n"
        f"PILOT Voice OS Assistant"
    )
    
    draft = await _call_text_llm(prompt, system_prompt="You are a professional email writing assistant. Draft structured, clean emails with Email, Cc/Bcc, Subject, Main Section Start headers, and Body.")
    
    # Store in session state
    state = get_state(req.session_id)
    state.pending_email_draft = draft
    state.pending_email_subject = req.subject
    state.pending_email_recipient_email = req.to_email
    state.pending_email_recipient_name = req.to_email.split('@')[0].title()
    
    # Push tool_start and tool_end events to trigger frontend reactivity
    job_id = str(uuid.uuid4())[:8]
    await bus.emit_event("tool_start", {
        "job_id": job_id, "tool": "write_email", "speaker": "User", "role": "user"
    }, req.session_id)
    
    await bus.emit_event("tool_end", {
        "job_id": job_id, "tool": "write_email",
        "result": {
            "status": "ok",
            "email_draft": draft,
            "recipient_name": state.pending_email_recipient_name,
            "recipient_email": req.to_email,
            "spoken_reply": "Email drafted successfully from form inputs."
        }
    }, req.session_id)
    
    return {"status": "ok", "email_draft": draft}
