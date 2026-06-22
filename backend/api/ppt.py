# """
# PPT API — upload .pptx, extract slides, serve reveal.js HTML viewer.
# """
# from fastapi import APIRouter, UploadFile, File, HTTPException
# from fastapi.responses import HTMLResponse
# from pydantic import BaseModel
# import os, json, re, asyncio, platform

# # Link Apple Silicon Homebrew library path so aspose.slides can find libgdiplus natively
# if platform.system() == "Darwin" and os.path.exists("/opt/homebrew/lib"):
#     os.environ["DYLD_LIBRARY_PATH"] = f"/opt/homebrew/lib:{os.environ.get('DYLD_LIBRARY_PATH', '')}"

# router = APIRouter()

# _slide_store: dict[str, list[dict]] = {}   # session_id → [{index, title, notes, bullets}]


# class PPTCmd(BaseModel):
#     session_id: str
#     direction:  str
#     slide_index: int = -1

# class JumpCmd(BaseModel):
#     session_id: str
#     query:      str


# @router.post("/navigate")
# async def navigate(cmd: PPTCmd):
#     from tools.ppt_copilot import ppt_navigate
#     return await ppt_navigate({"direction": cmd.direction}, cmd.session_id)


# @router.post("/jump")
# async def jump(cmd: JumpCmd):
#     from queues.bus import bus
#     slides = _slide_store.get(cmd.session_id, [])
#     q = cmd.query.lower()

#     # Numeric: "slide 42"
#     m = re.search(r'\b(\d+)\b', q)
#     if m:
#         idx = int(m.group(1)) - 1
#         await bus.emit_event("ppt_command", {"action":"goto","index":idx}, cmd.session_id)
#         title = slides[idx]["title"] if idx < len(slides) else f"Slide {idx+1}"
#         return {"status":"ok","index":idx,"title":title}

#     # Title fuzzy
#     best_idx, best_score = 0, 0
#     for s in slides:
#         score = sum(1 for w in q.split() if w in s.get("title","").lower())
#         if score > best_score:
#             best_score = score; best_idx = s["index"]
#     await bus.emit_event("ppt_command", {"action":"goto","index":best_idx}, cmd.session_id)
#     return {"status":"ok","index":best_idx}


# # ── REST routers ──
# # We will directly convert the PPTX into a PDF synchronously using LibreOffice if available, 
# # and render the PDF directly on the screen without converting page-by-page.

# # @router.post("/upload")
# # async def upload_ppt(session_id: str, file: UploadFile = File(...)):
# #     if not file.filename.lower().endswith((".pptx",".ppt")):
# #         raise HTTPException(400, "Only .pptx files supported")
# #     content = await file.read()
# #     os.makedirs("data/ppt", exist_ok=True)
# #     path = f"data/ppt/{session_id}.pptx"
# #     with open(path, "wb") as f:
# #         f.write(content)
        
# #     # We will convert the PPTX into a PDF asynchronously in the background.
# #     # While it's converting, we instantly generate the slide indexes using fast python-pptx (under 100ms)
# #     # and return them to the frontend so that the presentation starts immediately.
# #     slides = _extract_metadata_only_sync(path, session_id)
# #     _slide_store[session_id] = slides
    
# #     asyncio.create_task(asyncio.to_thread(_convert_ppt_to_pdf_async, path, session_id))
    
# #     return {"status":"ok","slide_count":len(slides),"slides":slides}

# @router.post("/upload")
# async def upload_ppt(
#     session_id: str,
#     file: UploadFile = File(...)
# ):
#     if not file.filename.lower().endswith(
#         (".pptx", ".ppt")
#     ):
#         raise HTTPException(
#             400,
#             "Only PPT/PPTX supported"
#         )

#     content = await file.read()

#     def _render():
#         from pptx import Presentation
#         import io

#         prs = Presentation(io.BytesIO(content))

#         slides = []

#         for i, slide in enumerate(prs.slides):
#             meta = _extract_slide_meta(
#                 slide,
#                 i,
#                 prs.slide_width,
#                 prs.slide_height
#             )

#             meta["img_b64"] = _slide_to_png_b64(
#                 slide,
#                 prs.slide_width,
#                 prs.slide_height
#             )

#             slides.append(meta)

#         return slides

#     slides = await asyncio.to_thread(_render)

#     _slide_store[session_id] = [
#         {
#             k: v
#             for k, v in s.items()
#             if k != "img_b64"
#         }
#         for s in slides
#     ]

#     return {
#         "status": "ok",
#         "slide_count": len(slides),
#         "slides": slides
#     }




# @router.get("/slides/{session_id}")
# async def get_slides(session_id: str):
#     return {"slides": _slide_store.get(session_id, [])}


# @router.get("/viewer/{session_id}", response_class=HTMLResponse)
# async def get_viewer(session_id: str):
#     """Return a reveal.js HTML page for the uploaded PPTX slides."""
#     slides = _slide_store.get(session_id, [])
#     if not slides:
#         return HTMLResponse("<p style='color:#888;padding:2rem'>No slides uploaded yet.</p>")
#     return HTMLResponse(_build_reveal_html(slides, session_id))




# @router.post("/summarise")
# async def summarise(data: dict):
#     """Use Gemini/Groq to summarise the presentation."""
#     from core.config import settings
#     prompt = data.get("prompt","")
#     try:
#         if settings.GEMINI_API_KEY:
#             import google.generativeai as genai
#             genai.configure(api_key=settings.GEMINI_API_KEY)
#             model = genai.GenerativeModel("gemini-1.5-flash")
#             resp = await asyncio.to_thread(model.generate_content, prompt)
#             return {"reply": resp.text.strip()}
#     except Exception as e:
#         pass
#     # Offline fallback
#     slides = _slide_store.get(data.get("session_id",""), [])
#     titles = " · ".join(s["title"] for s in slides[:8])
#     return {"reply": f"This presentation covers {len(slides)} slides including: {titles}"}


from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import asyncio
import base64
import html
import io
import json
import re

from core.slide_store import _slide_store, _current_slide, set_latest_upload_sid, get_latest_upload_sid

router = APIRouter()


# ============================================================
# MODELS
# ============================================================

class PPTCmd(BaseModel):
    session_id: str
    direction: str
    slide_index: int = -1


class JumpCmd(BaseModel):
    session_id: str
    query: str


# ============================================================
# IMAGE RENDERER
# ============================================================

def _slide_to_png_b64(
    slide,
    prs_w,
    prs_h,
    width_px=1280,
    height_px=720,
):
    import cairosvg

    scale_x = width_px / prs_w
    scale_y = height_px / prs_h

    bg_color = "#1a1a2e"

    text_els = ""

    for shape in slide.shapes:

        if not getattr(shape, "has_text_frame", False):
            continue

        x = int(shape.left * scale_x)
        y = int(shape.top * scale_y)

        cursor_y = y + 30

        for para in shape.text_frame.paragraphs:

            txt = para.text.strip()

            if not txt:
                continue

            txt = html.escape(txt)

            text_els += f"""
            <text
                x="{x}"
                y="{cursor_y}"
                fill="white"
                font-size="28"
                font-family="Arial">
                {txt}
            </text>
            """

            cursor_y += 40

    svg = f"""
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="{width_px}"
        height="{height_px}">
        <rect
            width="{width_px}"
            height="{height_px}"
            fill="{bg_color}" />
        {text_els}
    </svg>
    """

    png = cairosvg.svg2png(
        bytestring=svg.encode()
    )

    return base64.b64encode(png).decode()


# ============================================================
# SLIDE METADATA
# ============================================================

def _extract_slide_meta(
    slide,
    index,
    prs_w,
    prs_h
):
    title = ""

    try:
        if slide.shapes.title:
            title = slide.shapes.title.text.strip()
    except:
        pass

    bullets = []

    for shape in slide.shapes:

        if getattr(shape, "has_text_frame", False):

            txt = shape.text_frame.text.strip()

            if txt and txt != title:
                bullets.append(txt)

    notes = ""

    try:
        if (
            slide.has_notes_slide
            and slide.notes_slide.notes_text_frame
        ):
            notes = (
                slide.notes_slide
                .notes_text_frame
                .text[:300]
            )
    except:
        pass

    return {
        "index": index,
        "title": title or f"Slide {index+1}",
        "bullets": bullets[:6],
        "notes": notes,
    }


# ============================================================
# UPLOAD
# ============================================================

@router.post("/upload")
async def upload_ppt(
    session_id: str,
    file: UploadFile = File(...)
):

    if not file.filename.lower().endswith(
        (".pptx", ".ppt")
    ):
        raise HTTPException(
            status_code=400,
            detail="Only PPT/PPTX supported"
        )

    content = await file.read()

    def _render():

        from pptx import Presentation

        prs = Presentation(io.BytesIO(content))

        slides = []

        for i, slide in enumerate(prs.slides):

            meta = _extract_slide_meta(
                slide,
                i,
                prs.slide_width,
                prs.slide_height
            )

            meta["img_b64"] = _slide_to_png_b64(
                slide,
                prs.slide_width,
                prs.slide_height
            )

            slides.append(meta)

        return slides

    # Re-index to enforce 0-based slides metadata layout
    slides = await asyncio.to_thread(_render)

    _slide_store[session_id] = slides
    set_latest_upload_sid(session_id)
    _current_slide[session_id] = 0

    return {
        "status": "ok",
        "slide_count": len(slides),
        "slides": slides,
        "viewer_url": f"/api/v1/ppt/viewer/{session_id}"
    }


# ============================================================
# VIEWER
# ============================================================

def _build_reveal_html(
    slides,
    session_id
):

    sections = ""

    for slide in slides:

        sections += f"""
        <section>
            <img
                src="data:image/png;base64,{slide['img_b64']}"
                style="
                    width:100%;
                    height:100%;
                    object-fit:contain;
                "
            />
        </section>
        """

    return f"""
<!DOCTYPE html>
<html>
<head>

<link rel="stylesheet"
href="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.1.0/reveal.min.css">

<style>

html,
body {{
    margin:0;
    width:100%;
    height:100%;
    background:#111;
}}

.reveal {{
    width:100%;
    height:100%;
}}

</style>

</head>

<body>

<div class="reveal">
    <div class="slides">
        {sections}
    </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.1.0/reveal.min.js"></script>

<script>

Reveal.initialize({{
    controls:true,
    progress:true,
    slideNumber:true,
    hash:false
}});

window.addEventListener("message", (e) => {{

    const action = e.data?.action;

    if(action === "next")
        Reveal.next();

    else if(action === "prev")
        Reveal.prev();

    else if(action === "first")
        Reveal.slide(0);

    else if(action === "last")
        Reveal.slide({len(slides)-1});

    else if(
        action === "goto"
        && e.data.index !== undefined
    )
        Reveal.slide(e.data.index);
}});

Reveal.on("slidechanged", (event) => {{
    parent.postMessage({{
        type:"slide_changed",
        index:event.indexh
    }}, "*");
}});

</script>

</body>
</html>
"""


@router.get("/viewer/{session_id}",
            response_class=HTMLResponse)
async def get_viewer(session_id: str):

    slides = _slide_store.get(session_id)

    if not slides:
        return HTMLResponse(
            "<h2>No slides uploaded.</h2>"
        )

    return HTMLResponse(
        _build_reveal_html(
            slides,
            session_id
        )
    )


# ============================================================
# NAVIGATION
# ============================================================

@router.post("/navigate")
async def navigate(cmd: PPTCmd):

    from tools.ppt_copilot import ppt_navigate

    return await ppt_navigate(
        {"direction": cmd.direction},
        cmd.session_id
    )


@router.post("/jump")
async def jump(cmd: JumpCmd):

    from queues.bus import bus

    slides = _slide_store.get(
        cmd.session_id,
        []
    )

    q = cmd.query.lower()

    m = re.search(r"\b(\d+)\b", q)

    if m:

        idx = int(m.group(1)) - 1

        await bus.emit_event(
            "ppt_command",
            {
                "action":"goto",
                "index":idx
            },
            cmd.session_id
        )

        return {
            "status":"ok",
            "index":idx
        }

    return {
        "status":"ok",
        "index":0
    }


# ============================================================
# SUMMARY
# ============================================================

@router.post("/summarise")
async def summarise(data: dict):

    slides = _slide_store.get(
        data.get("session_id", ""),
        []
    )

    titles = ", ".join(
        slide["title"]
        for slide in slides[:8]
    )

    return {
        "reply":
        f"Presentation contains "
        f"{len(slides)} slides. "
        f"Topics: {titles}"
    }

@router.get("/slides/{session_id}")
async def get_slides(session_id: str):
    slides = _slide_store.get(session_id) or _slide_store.get(get_latest_upload_sid(), [])
    return {"slides": slides}

@router.post("/qa")
async def qa(data: dict):
    from tools.ppt_copilot import ppt_qa
    return await ppt_qa({"query": data.get("query", "")}, data.get("session_id", ""))
