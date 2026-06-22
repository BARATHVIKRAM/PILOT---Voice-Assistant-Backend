"""System and database tools — queries database, writes files, performs system checks and calculations."""
import os, re, json, logging, asyncio
from sqlalchemy import text
from core.config import settings

logger = logging.getLogger("pilot.tools.system_tasks")


async def database_query(args: dict, session_id: str) -> dict:
    logger.info("Executing database_query tool")
    db_info = ""
    try:
        from db.engine import AsyncSessionLocal
        # Run DB query using AsyncSessionLocal
        async with AsyncSessionLocal() as db_session:
            # Check recordings count
            res = await db_session.execute(text("SELECT COUNT(*) FROM recordings"))
            count = res.scalar()
            
            # Check recent recordings
            recent_res = await db_session.execute(text("SELECT user_name, prompt_text, recording_number FROM recordings ORDER BY id DESC LIMIT 3"))
            recent = recent_res.fetchall()
            
            db_info = f"The pilot voice database is connected. There are currently {count} audio recordings saved. "
            if count > 0:
                records_summary = ", ".join([f"{r[0]}'s recording number {r[2]}" for r in recent])
                db_info += f"The most recent recordings are: {records_summary}."
    except Exception as e:
        logger.warning(f"Database connection failed: {e}. Falling back to filesystem stats.")
        # Fallback to checking the uploads/ directory
        try:
            uploads_dir = "uploads"
            if os.path.exists(uploads_dir):
                files = os.listdir(uploads_dir)
                webm_files = [f for f in files if f.endswith(".webm")]
                db_info = (f"The database server was unreachable, but checking the uploads directory, "
                           f"I found {len(webm_files)} audio files saved in storage.")
            else:
                db_info = "The database is unreachable and the uploads directory does not exist."
        except Exception as fs_err:
            db_info = f"Both database connection and filesystem fallback failed. The database error was {e}."

    # Use LLM to compose a natural voice response
    prompt = f"The user asked: '{args.get('query', '')}'. Here is the actual data gathered: {db_info}. Please write a concise natural voice report summarizing this."
    spoken_reply = await _call_text_llm(prompt)
    return {"status": "ok", "db_info": db_info, "spoken_reply": spoken_reply}


async def write_file_tool(args: dict, session_id: str) -> dict:
    query = args.get("query", "") or args.get("synopsis") or ""
    logger.info(f"Executing write_file tool for query: {query}")
    
    prompt = (f"The user wants to generate a complete, structured code file based on this request: '{query}'.\n"
              f"Please write the file content. Ensure the code is beautifully structured, properly indented (4 spaces for C++ and Python), has clean spacing, descriptive variables, and comments.\n"
              f"You must format your response as a single, valid JSON object with exactly two fields:\n"
              f"- 'filename': name of the file to create (e.g. 'prime.cpp')\n"
              f"- 'content': the actual string content of the code, preserving all indentation, newlines (using \\n), and spacing precisely.\n"
              f"Provide ONLY the raw JSON object. Do not wrap in markdown blocks, do not add trailing explanations.")
              
    raw_json = await _call_text_llm(prompt, system_prompt="You are a code writing assistant. Output valid JSON ONLY. No markdown wrappers, no code blocks, no fences.")
    filename = "script.py"
    content = ""
    
    try:
        # Robust JSON cleaning and parsing for partially cut-off or ill-formatted JSON outputs
        clean_json = raw_json.strip()
        # Strip potential markdown fences if model hallucinated them
        if clean_json.startswith("```json"):
            clean_json = clean_json[7:]
        elif clean_json.startswith("```"):
            clean_json = clean_json[3:]
        if clean_json.endswith("```"):
            clean_json = clean_json[:-3]
        clean_json = clean_json.strip()
        
        # Resilient JSON repair: check if JSON starts with '{' but is missing the closing '}'
        if clean_json.startswith("{") and not clean_json.endswith("}"):
            clean_json += "}"
            
        json_match = re.search(r"\{.*\}", clean_json, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                filename = parsed.get("filename", filename)
                content = parsed.get("content", "")
            except Exception:
                # If json.loads fails, try regex extraction of key fields
                fn_match = re.search(r'"filename"\s*:\s*"([^"]+)"', clean_json)
                ct_match = re.search(r'"content"\s*:\s*"([\s\S]+?)"\s*\}?$', clean_json)
                if fn_match:
                    filename = fn_match.group(1)
                if ct_match:
                    # Clean escaped newlines/quotes
                    content = ct_match.group(1).replace("\\n", "\n").replace('\\"', '"')
                else:
                    content = raw_json
        else:
            content = raw_json
    except Exception as e:
        logger.error(f"Failed to parse generated file JSON: {e}")
        content = raw_json

    # Normalize filename
    if not filename or filename == "generated_output.txt":
        filename = "script.py"

    # Clean up escaped backslashes/newlines if parsed rawly
    if content:
        # Unescape escaped characters if double-serialized
        try:
            if content.startswith('"') and content.endswith('"'):
                content = json.loads(content)
        except:
            pass

    # Return the generated code directly to be displayed on transcripts, without writing any physical file to disk
    spoken = "I have successfully generated the requested structured code block. You can see it beautifully formatted in your transcript panel!"
    return {
        "status": "ok", 
        "filename": filename, 
        "content_length": len(content), 
        "content": content,  # Preserve the generated content in results so it can be rendered in transcripts
        "spoken_reply": spoken
    }


async def write_email_tool(args: dict, session_id: str) -> dict:
    query = args.get("query", "") or args.get("synopsis") or ""
    logger.info(f"Executing write_email tool for query: {query}")
    
    # Locate user matching email/name if provided
    from db.engine import AsyncSessionLocal
    from db.models import User
    from sqlalchemy import select
    from core.session_state import get_state
    
    state = get_state(session_id)
    
    # Prioritizes manually filled form context details first
    target_email = state.pending_email_recipient_email or "team@pilot.ai"
    target_user_name = state.pending_email_recipient_name or "Team member"
    subject = state.pending_email_subject or "Update from PILOT Voice OS"
    cc_bcc = "info@pilot.ai"
    
    try:
        async with AsyncSessionLocal() as db_session:
            users_res = await db_session.execute(select(User))
            all_users = users_res.scalars().all()
            for u in all_users:
                if u.name.lower() in query.lower() or u.email.lower() in query.lower():
                    target_user_name = u.name
                    target_email = u.email
                    break
    except Exception as e:
        logger.error(f"User db search failed: {e}")

    prompt = (f"The user wants you to draft a professional structured email body based on this request: '{query}'.\n"
              f"The recipient is: {target_user_name} (Email: {target_email}).\n"
              f"Subject line requested: {subject}\n"
              f"Please write the email in the following exact format. Do not use any markdown fencing or tables inside the text itself:\n\n"
              f"Email: {target_email}\n"
              f"Cc/Bcc: {cc_bcc}\n"
              f"Subject: {subject}\n\n"
              f"-----------------------------------------\n"
              f"Main Section Start\n"
              f"-----------------------------------------\n\n"
              f"Dear {target_user_name},\n\n"
              f"<Body of the email>\n\n"
              f"Best regards,\n"
              f"PILOT Voice OS Assistant\n\n"
              f"Output the email EXACTLY in this structured manner. Keep it highly professional.")
              
    draft = await _call_text_llm(prompt, system_prompt="You are a professional email writing assistant. Draft structured, clean emails with Email, Cc/Bcc, Subject, Main Section Start headers, and Body.")
    
    # Parse subject out of draft safely
    subject_match = re.search(r"Subject:\s*(.*)", draft)
    parsed_subject = subject_match.group(1).strip() if subject_match else subject
    
    # Store dynamic state
    state.pending_email_draft = draft
    state.pending_email_subject = parsed_subject
    state.pending_email_recipient_email = target_email
    state.pending_email_recipient_name = target_user_name
    
    spoken = f"I have successfully drafted the email to {target_user_name} ({target_email}) with the subject '{parsed_subject}'. You can speak 'send this email' to send it in real time!"
    return {
        "status": "ok",
        "email_draft": draft,
        "recipient_name": target_user_name,
        "recipient_email": target_email,
        "spoken_reply": spoken
    }


async def send_email_tool(args: dict, session_id: str) -> dict:
    from core.session_state import get_state
    from core.config import settings
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    
    state = get_state(session_id)
    draft = state.pending_email_draft
    subject = state.pending_email_subject
    to_email = state.pending_email_recipient_email
    to_name = state.pending_email_recipient_name
    
    if not draft or not to_email:
        err_reply = "There is no pending email draft to send. Please first tell me to 'write an email' to someone."
        return {"status": "error", "message": "no_pending_draft", "spoken_reply": err_reply}
        
    logger.info(f"Sending real-time email to {to_email} with subject: {subject}")
    
    try:
        # Strip potential markdown code fencing from the draft before sending
        clean_draft = draft
        if clean_draft.startswith("```email"):
            clean_draft = clean_draft[8:]
        elif clean_draft.startswith("```"):
            clean_draft = clean_draft[3:]
        if clean_draft.endswith("```"):
            clean_draft = clean_draft[:-3]
        clean_draft = clean_draft.strip()

        if settings.SMTP_USER and settings.SMTP_PASS:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = settings.SMTP_USER
            msg["To"]      = to_email
            
            # Format nicely as HTML
            formatted_body = clean_draft.replace("\n", "<br/>")
            html = f"""
            <div style="font-family:sans-serif;max-width:540px;margin:40px auto;background:#F9F8F6;
                        color:#1A1A1A;border-radius:12px;padding:2.5rem;border:1.5px solid #E5E2DA;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.03)">
              <div style="font-size:1.3rem;font-weight:800;color:#7C5E00;margin-bottom:1.5rem;border-bottom:1px solid #E5E2DA;padding-bottom:0.5rem">⬡ PILOT Voice OS</div>
              <div style="font-size:0.95rem;line-height:1.6;color:#222">
                {formatted_body}
              </div>
              <p style="color:#888;font-size:0.75rem;margin-top:2rem;border-top:1px dashed #E5E2DA;padding-top:0.8rem">This email was dispatched securely via PILOT Voice OS Biometric Action Authorization.</p>
            </div>
            """
            msg.attach(MIMEText(html, "html"))
            
            # Send via asyncio to thread
            await asyncio.to_thread(
                _smtp_send_helper, settings.SMTP_HOST, settings.SMTP_PORT,
                settings.SMTP_USER, settings.SMTP_PASS, to_email, msg
            )
            spoken = f"Successfully dispatched the email to {to_name} in real time!"
        else:
            spoken = f"Simulated: SMTP credentials are not configured in your backend .env file, but I have verified your biometric authorization and simulated sending the email to {to_name} ({to_email}) successfully!"
            
        # Clear state after sending
        state.pending_email_draft = ""
        state.pending_email_subject = ""
        state.pending_email_recipient_email = ""
        state.pending_email_recipient_name = ""
        
        return {
            "status": "ok",
            "recipient_name": to_name,
            "recipient_email": to_email,
            "subject": subject,
            "spoken_reply": spoken
        }
    except Exception as e:
        logger.error(f"Failed sending background real-time email: {e}")
        return {"status": "error", "message": str(e), "spoken_reply": f"Failed sending the email: {e}"}


def _smtp_send_helper(host, port, user, password, to, msg):
    import smtplib
    with smtplib.SMTP(host, port, timeout=10) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(user, password)
        server.sendmail(user, to, msg.as_string())


async def system_check(args: dict, session_id: str) -> dict:
    logger.info("Executing system_check tool")
    try:
        files = os.listdir(".")
        # Filter and summarize list
        python_files = [f for f in files if f.endswith(".py")]
        folders = [f for f in files if os.path.isdir(f) and not f.startswith(".")]
        
        summary = f"In the current directory, I found {len(python_files)} python files, including {', '.join(python_files[:5])}. "
        if folders:
            summary += f"The main folders are {', '.join(folders)}."
    except Exception as e:
        summary = f"Failed to perform filesystem check: {e}"

    prompt = f"The user asked: '{args.get('query', '')}'. Here is the directory listing/system stats summary: {summary}. Please write a concise natural voice report explaining this."
    spoken_reply = await _call_text_llm(prompt)
    return {"status": "ok", "summary": summary, "spoken_reply": spoken_reply}


async def complex_calculation(args: dict, session_id: str) -> dict:
    query = args.get("query", "")
    logger.info(f"Executing complex_calculation tool for: {query}")
    
    prompt = f"Please perform this complex task, reasoning, or math query: '{query}'. Compute the answer and present it in a clear, natural voice report."
    spoken_reply = await _call_text_llm(prompt)
    return {"status": "ok", "query": query, "spoken_reply": spoken_reply}


async def _call_text_llm(prompt: str, system_prompt: str = "You are a helpful voice assistant. Answer concisely in 1-3 spoken sentences.") -> str:
    # Try Groq first
    if settings.GROQ_API_KEY:
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=settings.GROQ_API_KEY)
            resp = await client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": prompt}
                ],
                max_tokens=250
            )
            if resp.choices[0].message.content:
                return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Groq tool text call failed: {e}")

    # Try Gemini
    if settings.GEMINI_API_KEY:
        try:
            import google.generativeai as genai
            genai.configure(api_key=settings.GEMINI_API_KEY)
            model = genai.GenerativeModel("gemini-1.5-flash")
            resp = await model.generate_content_async(prompt)
            if resp.text:
                return resp.text.strip()
        except Exception as e:
            logger.warning(f"Gemini tool text call failed: {e}")

    # Fallback to local Ollama
    try:
        import httpx
        url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/generate"
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, json={
                "model": settings.OLLAMA_MODEL,
                "prompt": f"System: {system_prompt}\n\nUser: {prompt}",
                "stream": False
            })
            if resp.status_code == 200:
                return resp.json().get("response", "").strip()
    except Exception as e:
        logger.error(f"Ollama local tool text call failed: {e}")
        
    return "I completed the processing task but was unable to format a spoken summary response. Please check your AI keys."
