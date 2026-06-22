# """PPT tools — navigate + jump to slide by number or title."""
# import logging
# logger = logging.getLogger("pilot.tools.ppt")


# async def ppt_navigate(args: dict, session_id: str) -> dict:
#     direction = args.get("direction", "next")
#     from queues.bus import bus
#     await bus.emit_event("ppt_command", {"action": direction}, session_id)
#     return {"status": "ok", "direction": direction}


# async def ppt_jump_to_title(args: dict, session_id: str) -> dict:
#     query        = args.get("query", "")
#     slide_number = args.get("slide_number")   # already 0-indexed if from keyword fallback
#     from queues.bus import bus

#     # If explicit slide number given, use directly
#     if slide_number is not None:
#         idx = int(slide_number)
#         await bus.emit_event("ppt_command", {"action": "goto", "index": idx}, session_id)
#         return {"status": "ok", "index": idx, "title": f"Slide {idx+1}"}

#     # Otherwise fuzzy match against uploaded slides
#     from api.ppt import _slide_store
#     import re
#     slides = _slide_store.get(session_id, [])
#     q = query.lower()

#     # Numeric match in query
#     m = re.search(r'\b(\d+)\b', q)
#     if m:
#         idx = int(m.group(1)) - 1
#         if 0 <= idx < max(len(slides), 50):
#             await bus.emit_event("ppt_command", {"action": "goto", "index": idx}, session_id)
#             return {"status": "ok", "index": idx}

#     # Title fuzzy match
#     best_idx, best_score = 0, 0
#     for s in slides:
#         score = sum(1 for w in q.split() if w in s.get("title","").lower())
#         if score > best_score:
#             best_score = score; best_idx = s["index"]

#     await bus.emit_event("ppt_command", {"action": "goto", "index": best_idx}, session_id)
#     return {"status": "ok", "index": best_idx}


# async def ppt_delete_slide(args: dict, session_id: str) -> dict:
#     from queues.bus import bus
#     await bus.emit_event("ppt_command", {"action": "delete"}, session_id)
#     return {"status": "ok", "spoken_reply": "Deleting the current slide now."}


# async def ppt_summarize(args: dict, session_id: str) -> dict:
#     from api.ppt import _slide_store
#     # Fall back to "default" key for slides uploaded before session started
#     slides = _slide_store.get(session_id, []) or _slide_store.get("default", [])
#     if not slides:
#         return {"spoken_reply": "No presentation is loaded yet. Please upload a PowerPoint file first."}

#     lines = []
#     for s in slides:
#         title = s.get("title", f"Slide {s['index']+1}")
#         notes = s.get("notes", "")
#         lines.append(f"Slide {s['index']+1}: {title}" + (f" — {notes}" if notes else ""))

#     content = "\n".join(lines)
#     summary = await _summarize_groq(content)
#     return {"spoken_reply": summary}


# async def _summarize_groq(content: str) -> str:
#     # Use our fast active Groq LLM instead of Ollama for reliable presentation summarization
#     try:
#         from groq import AsyncGroq
#         from core.config import settings
#         if settings.GROQ_API_KEY:
#             client = AsyncGroq(api_key=settings.GROQ_API_KEY)
#             resp = await client.chat.completions.create(
#                 model="llama-3.1-8b-instant",
#                 messages=[
#                     {"role": "system", "content":
#                         "You are a helpful voice assistant. Summarize the presentation in 4-6 natural spoken sentences. "
#                         "Mention the main topics and key points. No markdown, no bullet points — plain conversational speech only."},
#                     {"role": "user", "content": f"Summarize this presentation:\n\n{content[:3000]}"},
#                 ],
#                 max_tokens=250,
#                 temperature=0.0
#             )
#             return resp.choices[0].message.content.strip()
#     except Exception as e:
#         logger.error(f"ppt_summarize groq error: {e}")
        
#     # Fallback to local Ollama if Groq fails
#     try:
#         def _call() -> str:
#             import ollama
#             from core.config import settings
#             resp = ollama.chat(
#                 model=settings.OLLAMA_MODEL,
#                 messages=[
#                     {"role": "system", "content":
#                         "You are a helpful voice assistant. Summarize the presentation in 4-6 natural spoken sentences. "
#                         "Mention the main topics and key points. No markdown, no bullet points — plain conversational speech only."},
#                     {"role": "user", "content": f"Summarize this presentation:\n\n{content[:3000]}"},
#                 ],
#                 think=False,
#                 options={"num_predict": 220},
#                 stream=False,
#             )
#             if isinstance(resp, dict):
#                 return resp["message"]["content"].strip()
#             return resp.message.content.strip()

#         return await asyncio.to_thread(_call)
#     except Exception as ex:
#         logger.error(f"ppt_summarize ollama fallback error: {ex}")
#         return "I wasn't able to summarize the presentation right now. Please try again."

"""PPT tools — navigate + jump to slide by number or title + summarize."""
import asyncio, logging
logger = logging.getLogger("pilot.tools.ppt")

from core.slide_store import _slide_store, _current_slide, resolve_sid

async def ppt_navigate(args: dict, session_id: str) -> dict:
    direction = args.get("direction", "next")
    from queues.bus import bus

    effective_sid = resolve_sid(session_id)
    slides = _slide_store.get(effective_sid, [])
    total = len(slides)
    current = _current_slide.get(effective_sid, 0)

    if direction == "next":
        if total > 0 and current >= total - 1:
            return {"spoken_reply": f"You've reached the last slide — slide {total} of {total}. That's the end of the presentation."}
        _current_slide[effective_sid] = min(current + 1, max(total - 1, 0))
    elif direction == "prev":
        if current <= 0:
            return {"spoken_reply": "You're already on the first slide."}
        _current_slide[effective_sid] = max(current - 1, 0)
    elif direction == "first":
        _current_slide[effective_sid] = 0
    elif direction == "last":
        _current_slide[effective_sid] = max(total - 1, 0)

    await bus.emit_event("ppt_command", {"action": direction}, session_id)
    return {"status": "ok", "direction": direction}

async def ppt_jump_to_title(args: dict, session_id: str) -> dict:
    query        = args.get("query", "")
    slide_number = args.get("slide_number")   # already 0-indexed if from keyword fallback
    from queues.bus import bus
    import re

    effective_sid = resolve_sid(session_id)
    slides = _slide_store.get(effective_sid, [])

    # If explicit slide number given, use directly
    if slide_number is not None:
        idx = int(slide_number)
        _current_slide[effective_sid] = idx
        await bus.emit_event("ppt_command", {"action": "goto", "index": idx}, session_id)
        return {"status": "ok", "index": idx, "title": f"Slide {idx+1}"}

    q = query.lower()

    # Numeric match in query — only allow within actual deck bounds
    m = re.search(r'\b(\d+)\b', q)
    if m:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(slides):
            _current_slide[effective_sid] = idx
            await bus.emit_event("ppt_command", {"action": "goto", "index": idx}, session_id)
            return {"status": "ok", "index": idx}

    # Title fuzzy match
    best_idx, best_score = 0, 0
    for s in slides:
        score = sum(1 for w in q.split() if w in s.get("title","").lower())
        if score > best_score:
            best_score = score; best_idx = s["index"]

    _current_slide[effective_sid] = best_idx
    await bus.emit_event("ppt_command", {"action": "goto", "index": best_idx}, session_id)
    return {"status": "ok", "index": best_idx}


async def ppt_delete_slide(args: dict, session_id: str) -> dict:
    from queues.bus import bus
    await bus.emit_event("ppt_command", {"action": "delete"}, session_id)
    return {"status": "ok", "spoken_reply": "Deleting the current slide now."}


async def ppt_summarize(args: dict, session_id: str) -> dict:
    effective_sid = resolve_sid(session_id)
    slides = _slide_store.get(effective_sid, []) or _slide_store.get("default", [])
    if not slides:
        return {"spoken_reply": "No presentation is loaded yet. Please upload a PowerPoint file first."}

    lines = []
    for s in slides:
        title = s.get("title", f"Slide {s['index']+1}")
        notes = s.get("notes", "")
        lines.append(f"Slide {s['index']+1}: {title}" + (f" — {notes}" if notes else ""))

    content = "\n".join(lines)
    summary = await _summarize_ollama(content)
    return {"spoken_reply": summary}


async def _summarize_ollama(content: str) -> str:
    def _call() -> str:
        import ollama
        from core.config import settings
        resp = ollama.chat(
            model=settings.OLLAMA_MODEL,
            messages=[
                {"role": "system", "content":
                    "You are a helpful voice assistant. Summarize the presentation in 4-6 natural spoken sentences. "
                    "Mention the main topics and key points. No markdown, no bullet points — plain conversational speech only."},
                {"role": "user", "content": f"Summarize this presentation:\n\n{content[:30000]}"},
            ],
            think=False,
            options={"num_predict": 220},
            stream=False,
        )
        if isinstance(resp, dict):
            return resp["message"]["content"].strip()
        return resp.message.content.strip()

    try:
        return await asyncio.to_thread(_call)
    except Exception as e:
        logger.error(f"ppt_summarize ollama error: {e}")
        return "I wasn't able to summarize the presentation right now. Please try again."


async def ppt_qa(args: dict, session_id: str) -> dict:
    import re
    
    query = args.get("query", "").strip()
    if not query:
        return {"spoken_reply": "I'm here! What would you like to know about the slides?", "status": "ok"}
        
    effective_sid = resolve_sid(session_id)
    slides = _slide_store.get(effective_sid, []) or _slide_store.get("default", [])
    if not slides:
        return {"spoken_reply": "I don't have any presentation slides loaded yet. Please upload a PowerPoint file first.", "status": "ok"}
        
    # Extract slide number/index
    # Supports word equivalents of numbers as well
    word_to_num = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
        "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
        "nineteen": 19, "twenty": 20,
    }
    
    slide_index = None
    num_match = re.search(r"slide\s+(\d+)", query.lower())
    if num_match:
        slide_index = int(num_match.group(1)) - 1
    else:
        for word, num in word_to_num.items():
            if re.search(rf"\bslide\s+{word}\b", query.lower()):
                slide_index = num - 1
                break
                
    # If explicit slide index was matched and is valid
    if slide_index is not None and 0 <= slide_index < len(slides):
        slide = slides[slide_index]
        title = slide.get("title", f"Slide {slide_index+1}")
        bullets_text = " ".join(slide.get("bullets", []))
        notes = slide.get("notes", "")
        img_b64 = slide.get("img_b64")
        
        slide_desc = f"Slide {slide_index+1}: {title}. Content: {bullets_text}."
        if notes:
            slide_desc += f" Speaker Notes: {notes}."
            
        logger.info(f"Answering PPT Q&A for slide {slide_index+1} using slide data.")
        
        prompt = (
            f"The user is asking: '{query}'. This is regarding slide {slide_index+1} "
            f"of the presentation, which is titled '{title}'. "
            f"The text content on this slide is: '{bullets_text}'. "
            f"Speaker notes for this slide say: '{notes}'.\n"
            f"Please write a friendly, clear, and comprehensive spoken response of 2-3 sentences answering the user's question directly based on this slide content."
        )
        
        # If image is available and we have a vision-capable provider
        if img_b64:
            logger.info("Slide image is available. Calling Vision LLM.")
            reply = await _call_vision_llm(prompt, img_b64)
            if reply:
                return {"spoken_reply": reply, "status": "ok", "slide_index": slide_index}
                
        # Text-only fallback
        reply = await _call_text_llm(prompt)
        return {"spoken_reply": reply, "status": "ok", "slide_index": slide_index}
        
    else:
        # General presentation Q&A
        all_content = []
        for s in slides:
            bullets_str = ", ".join(s.get("bullets", []))
            all_content.append(f"Slide {s['index']+1} (Title: {s.get('title','')}): {bullets_str}")
        full_structure = "\n".join(all_content)
        
        prompt = (
            f"The user is asking a question about the PowerPoint presentation: '{query}'. "
            f"Here is the text structure extracted from the presentation:\n"
            f"{full_structure[:30000]}\n"
            f"Please write a friendly, concise spoken response of 2-3 sentences answering their question directly based on the presentation slides."
        )
        
        logger.info("General PPT Q&A. Answering using full presentation text structure.")
        reply = await _call_text_llm(prompt)
        return {"spoken_reply": reply, "status": "ok"}


async def _call_vision_llm(prompt: str, img_b64: str) -> str | None:
    from core.config import settings
    
    # Try Gemini Vision first (always preferred)
    if settings.GEMINI_API_KEY:
        try:
            import google.generativeai as genai
            import base64
            genai.configure(api_key=settings.GEMINI_API_KEY)
            # Use gemini-2.5-flash as it is the absolute latest and highest-capability Gemini model for vision and MCP Q&A
            model = genai.GenerativeModel("gemini-2.5-flash")
            img_bytes = base64.b64decode(img_b64)
            resp = await model.generate_content_async([
                prompt,
                {"mime_type": "image/png", "data": img_bytes}
            ])
            if resp.text:
                return resp.text.strip()
        except Exception as e:
            logger.warning(f"Gemini vision PPT Q&A failed: {e}")
            
    # Try Groq vision if key is active
    if settings.GROQ_API_KEY:
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=settings.GROQ_API_KEY)
            resp = await client.chat.completions.create(
                model="llama-3.2-11b-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                        ]
                    }
                ],
                max_tokens=200,
            )
            if resp.choices[0].message.content:
                return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Groq vision PPT Q&A failed: {e}")
            
    return None


async def _call_text_llm(prompt: str) -> str:
    from core.config import settings
    
    # Try Groq first
    if settings.GROQ_API_KEY:
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=settings.GROQ_API_KEY)
            resp = await client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": "You are a helpful voice assistant. Answer concisely in 1-3 spoken sentences."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=200
            )
            if resp.choices[0].message.content:
                return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Groq PPT text Q&A failed: {e}")

    # Try Gemini
    if settings.GEMINI_API_KEY:
        try:
            import google.generativeai as genai
            genai.configure(api_key=settings.GEMINI_API_KEY)
            # Use gemini-2.5-flash as it is the absolute latest and highest-capability Gemini model for text Q&A
            model = genai.GenerativeModel("gemini-2.5-flash")
            resp = await model.generate_content_async(prompt)
            if resp.text:
                return resp.text.strip()
        except Exception as e:
            logger.warning(f"Gemini PPT text Q&A failed: {e}")

    # Fallback to local Ollama
    try:
        import httpx
        url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/generate"
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, json={
                "model": settings.OLLAMA_MODEL,
                "prompt": f"System: You are a helpful voice assistant. Answer concisely in 1-3 spoken sentences.\n\nUser: {prompt}",
                "stream": False
            })
            if resp.status_code == 200:
                return resp.json().get("response", "").strip()
    except Exception as e:
        logger.error(f"Ollama local PPT text Q&A failed: {e}")
        
    return "I analyzed the presentation slide but was unable to generate a response. Please check your AI API keys."