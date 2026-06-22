"""
Instant PPT slide renderer — no system-dependent cairosvg, no polling.
Converts every slide to a beautiful PNG image using LibreOffice + PyMuPDF (fitz)
with standard text SVG fallback in pure python-pptx (fitz).
"""
import io, base64, html, asyncio, json, time, os, shutil, subprocess, tempfile
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from core.slide_store import _slide_store

logger = logging.getLogger("pilot.ppt.instant")
router = APIRouter()


# ── Core renderer ──────────────────────────────────────────────────────────────

def _slide_to_png_b64(slide, prs_w: int, prs_h: int,
                       width_px: int = 960, height_px: int = 540) -> str:
    """Render one slide to a base64-encoded PNG string using PyMuPDF (no cairosvg/cairo dependency)."""
    import fitz

    scale_x = width_px / prs_w
    scale_y = height_px / prs_h

    # Background fill
    bg_color = "#1a1a2e"
    try:
        bg = slide.background.fill
        if hasattr(bg, "fore_color") and bg.fore_color.type:
            rgb = bg.fore_color.rgb
            bg_color = f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
    except Exception:
        pass

    text_els = ""
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        x = int(shape.left  * scale_x)
        y = int(shape.top   * scale_y)

        cursor_y = y + 22
        for para in shape.text_frame.paragraphs:
            raw = para.text.strip()
            if not raw:
                cursor_y += 12
                continue

            font_size, bold, color = 18, False, "#ffffff"
            try:
                if para.font.size:  font_size = int(para.font.size.pt)
                if para.font.bold:  bold = True
                if para.font.color and para.font.color.type:
                    rgb = para.font.color.rgb
                    color = f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
            except Exception:
                pass
            for run in para.runs:
                try:
                    if run.font.size:  font_size = int(run.font.size.pt)
                    if run.font.bold:  bold = True
                    if run.font.color and run.font.color.type:
                        rgb = run.font.color.rgb
                        color = f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
                except Exception:
                    pass

            fs  = max(int(font_size * min(scale_x, scale_y) * 0.85), 8)
            fw  = "bold" if bold else "normal"
            safe = html.escape(raw)
            # Wrap long text with tspan elements
            words = safe.split()
            lines, cur_line, max_chars = [], [], int(width_px / (fs * 0.6))
            for w in words:
                cur_line.append(w)
                if len(" ".join(cur_line)) > max_chars:
                    lines.append(" ".join(cur_line[:-1]))
                    cur_line = [w]
            if cur_line:
                lines.append(" ".join(cur_line))

            for line in lines:
                text_els += (
                    f'<text x="{x+6}" y="{cursor_y}" '
                    f'font-size="{fs}" font-weight="{fw}" fill="{color}" '
                    f'font-family="Inter,Arial,sans-serif">'
                    f'{line}</text>\n'
                )
                cursor_y += int(fs * 1.45)
            cursor_y += 4

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width_px}" height="{height_px}">'
        f'<rect width="{width_px}" height="{height_px}" fill="{bg_color}"/>'
        f'{text_els}'
        f'</svg>'
    )
    
    # Render SVG directly to PNG in memory using PyMuPDF (completely self-contained, no native cairo library needed)
    try:
        svg_doc = fitz.open("svg", svg.encode("utf-8"))
        page = svg_doc[0]
        pix = page.get_pixmap()
        png_data = pix.tobytes("png")
        svg_doc.close()
        return base64.b64encode(png_data).decode()
    except Exception as e:
        logger.error(f"Fallback SVG-to-PNG render failed: {e}")
        return ""


def _extract_slide_meta(slide, index: int, prs_w: int, prs_h: int) -> dict:
    """Fast metadata extraction (title, bullets, notes) for one slide."""
    title = ""
    try:
        if slide.shapes.title:
            title = slide.shapes.title.text.strip()
    except Exception:
        pass

    bullets = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            text = shape.text_frame.text.strip()
            if text and text != title:
                bullets.append(text)

    notes = ""
    try:
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = slide.notes_slide.notes_text_frame.text.strip()[:300]
    except Exception:
        pass

    return {
        "index":   index,
        "title":   title or f"Slide {index + 1}",
        "bullets": bullets[:6],
        "notes":   notes,
    }


def _get_libreoffice_path() -> str | None:
    """Resolves headless soffice executable binary path across platforms."""
    soffice_path = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice_path:
        for p in ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/opt/homebrew/bin/soffice", "/usr/local/bin/soffice"]:
            if os.path.exists(p):
                soffice_path = p
                break
    return soffice_path


# ── Route 1: all slides at once (best for ≤30 slides) ─────────────────────────

@router.post("/upload_instant")
async def upload_instant(session_id: str, file: UploadFile = File(...)):
    """
    Upload PPTX → returns JSON with all slides including inline base64 PNG images.
    High-fidelity PDF-rendered slide flow with instant fallbacks.
    """
    if not file.filename.lower().endswith((".pptx", ".ppt")):
        raise HTTPException(400, "Only .pptx / .ppt files supported")

    content = await file.read()

    def _render_all() -> list[dict]:
        from pptx import Presentation
        import fitz
        
        # Suppress non-fatal MuPDF structural layout parser warnings safely across different PyMuPDF versions
        try:
            if hasattr(fitz, "TOOLS"):
                fitz.TOOLS.mupdf_display_errors(False)
        except Exception:
            pass
        
        prs = Presentation(io.BytesIO(content))
        prs_w = prs.slide_width
        prs_h = prs.slide_height
        
        # 1. Fast metadata extraction
        slides_out = []
        for i, slide in enumerate(prs.slides):
            meta = _extract_slide_meta(slide, i, prs_w, prs_h)
            slides_out.append(meta)
            
        # 2. Try High-Fidelity LibreOffice PDF rasterization
        soffice_path = _get_libreoffice_path()
        pdf_rendered = False
        
        if soffice_path:
            try:
                with tempfile.TemporaryDirectory() as temp_dir:
                    pptx_temp_path = os.path.join(temp_dir, "presentation.pptx")
                    with open(pptx_temp_path, "wb") as f_temp:
                        f_temp.write(content)
                        
                    cmd = [soffice_path, "--headless", "--convert-to", "pdf", "--outdir", temp_dir, pptx_temp_path]
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    pdf_filename = "presentation.pdf"
                    pdf_path = os.path.join(temp_dir, pdf_filename)
                    if os.path.exists(pdf_path):
                        doc = fitz.open(pdf_path)
                        for i, page in enumerate(doc):
                            if i < len(slides_out):
                                pix = page.get_pixmap(dpi=120)
                                png_bytes = pix.tobytes("png")
                                slides_out[i]["img_b64"] = base64.b64encode(png_bytes).decode()
                        doc.close()
                        pdf_rendered = True
                        logger.info("Successfully rendered all slides to PNG via LibreOffice PDF pipeline.")
            except Exception as lo_err:
                logger.error(f"LibreOffice instant conversion failed: {lo_err}")
                
        # 3. Fallback: Pure-Python vector layout PNG rendering via PyMuPDF (fitz)
        if not pdf_rendered:
            for i, slide in enumerate(prs.slides):
                slides_out[i]["img_b64"] = _slide_to_png_b64(slide, prs_w, prs_h)
                
        return slides_out

    slides = await asyncio.to_thread(_render_all)

    # Persist full slide information including high-fidelity slide image base64 strings so background agents have full access to diagrams
    _slide_store[session_id] = slides

    return {"status": "ok", "slide_count": len(slides), "slides": slides}


# ── Route 2: SSE stream (best for large decks — slide 1 arrives in ~50ms) ─────

@router.post("/upload_stream")
async def upload_stream(session_id: str, file: UploadFile = File(...)):
    """Upload PPTX → SSE stream. Emits rendered PNG slides slide-by-slide."""
    if not file.filename.lower().endswith((".pptx", ".ppt")):
        raise HTTPException(400, "Only .pptx / .ppt files supported")

    content = await file.read()

    async def _event_generator():
        from pptx import Presentation
        import fitz

        prs = Presentation(io.BytesIO(content))
        prs_w  = prs.slide_width
        prs_h  = prs.slide_height
        total  = len(prs.slides)
        store_list: list[dict] = []

        yield f"data: {json.dumps({'type': 'init', 'total': total})}\n\n"
        
        # 1. First, try to generate LibreOffice high-fidelity PDF converter
        soffice_path = _get_libreoffice_path()
        pdf_doc = None
        
        if soffice_path:
            try:
                # Synchronous but extremely fast (~2 seconds), non-blocking in SSE generator thread
                temp_dir = tempfile.mkdtemp()
                pptx_temp_path = os.path.join(temp_dir, "presentation.pptx")
                with open(pptx_temp_path, "wb") as f_temp:
                    f_temp.write(content)
                    
                cmd = [soffice_path, "--headless", "--convert-to", "pdf", "--outdir", temp_dir, pptx_temp_path]
                # Run with small timeout to prevent potential hangs
                subprocess.run(cmd, check=True, timeout=10.0, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                pdf_filename = "presentation.pdf"
                pdf_path = os.path.join(temp_dir, pdf_filename)
                if os.path.exists(pdf_path):
                    pdf_doc = fitz.open(pdf_path)
            except Exception as lo_err:
                logger.error(f"SSE background LibreOffice PDF conversion failed: {lo_err}")

        # 2. Emit slides slide-by-slide
        for i, slide in enumerate(prs.slides):
            meta = await asyncio.to_thread(_extract_slide_meta, slide, i, prs_w, prs_h)
            img_b64 = ""
            
            if pdf_doc and i < len(pdf_doc):
                try:
                    page = pdf_doc[i]
                    pix = await asyncio.to_thread(page.get_pixmap, dpi=120)
                    png_bytes = pix.tobytes("png")
                    img_b64 = base64.b64encode(png_bytes).decode()
                except Exception as page_err:
                    logger.error(f"Failed to render slide page {i} from PDF: {page_err}")
                    
            # Fallback to python-pptx SVG renderer if PDF page rendering was unavailable
            if not img_b64:
                img_b64 = await asyncio.to_thread(_slide_to_png_b64, slide, prs_w, prs_h)

            store_list.append({
                **meta,
                "img_b64": img_b64
            })
            payload = {**meta, "img_b64": img_b64, "total": total, "type": "slide"}
            yield f"data: {json.dumps(payload)}\n\n"

        # Cleanup PDF resources
        if pdf_doc:
            pdf_doc.close()
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except:
                pass

        _slide_store[session_id] = store_list
        # Synchronize fallback tracking keys in core slide_store namespace cleanly during streaming completions
        from core.slide_store import set_latest_upload_sid, _current_slide
        set_latest_upload_sid(session_id)
        _current_slide[session_id] = 0
        
        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"
    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── Route 3: Prepared stream (Step 1 and Step 2 split) ──────────────────────────

@router.post("/upload_prepare")
async def upload_prepare(session_id: str, file: UploadFile = File(...)):
    """Fast file saver to prepare the presentation file on disk."""
    if not file.filename.lower().endswith((".pptx", ".ppt")):
        raise HTTPException(400, "Only .pptx / .ppt files supported")

    content = await file.read()
    import os
    os.makedirs("data/ppt", exist_ok=True)
    path = f"data/ppt/{session_id}.pptx"
    with open(path, "wb") as f:
        f.write(content)
    return {"status": "ok"}


@router.get("/render_stream")
async def render_stream(session_id: str, token: str):
    """EventSource endpoint called by the frontend to render the slides page-by-page."""
    from core.security import decode_token
    try:
        decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Missing or invalid credentials")

    import os
    path = f"data/ppt/{session_id}.pptx"
    if not os.path.exists(path):
        raise HTTPException(404, "Prepared presentation file not found")

    async def _event_generator():
        from pptx import Presentation
        import fitz
        
        # Suppress non-fatal MuPDF structural layout parser warnings safely across different PyMuPDF versions during streams
        try:
            if hasattr(fitz, "TOOLS"):
                fitz.TOOLS.mupdf_display_errors(False)
        except Exception:
            pass

        prs = Presentation(path)
        prs_w  = prs.slide_width
        prs_h  = prs.slide_height
        total  = len(prs.slides)
        store_list: list[dict] = []

        yield f"data: {json.dumps({'type': 'init', 'total': total})}\n\n"
        
        # 1. Try LibreOffice headless conversion
        soffice_path = _get_libreoffice_path()
        pdf_doc = None
        
        if soffice_path:
            try:
                temp_dir = tempfile.mkdtemp()
                cmd = [soffice_path, "--headless", "--convert-to", "pdf", "--outdir", temp_dir, path]
                subprocess.run(cmd, check=True, timeout=15.0, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                pdf_filename = os.path.splitext(os.path.basename(path))[0] + ".pdf"
                pdf_path = os.path.join(temp_dir, pdf_filename)
                if os.path.exists(pdf_path):
                    pdf_doc = fitz.open(pdf_path)
            except Exception as lo_err:
                logger.error(f"render_stream LibreOffice PDF conversion failed: {lo_err}")

        # 2. Iterate and render
        for i, slide in enumerate(prs.slides):
            meta = await asyncio.to_thread(_extract_slide_meta, slide, i, prs_w, prs_h)
            img_b64 = ""
            
            if pdf_doc and i < len(pdf_doc):
                try:
                    page = pdf_doc[i]
                    pix = await asyncio.to_thread(page.get_pixmap, dpi=120)
                    png_bytes = pix.tobytes("png")
                    img_b64 = base64.b64encode(png_bytes).decode()
                except Exception as page_err:
                    logger.error(f"Failed to render slide page {i} from PDF: {page_err}")
                    
            if not img_b64:
                img_b64 = await asyncio.to_thread(_slide_to_png_b64, slide, prs_w, prs_h)

            store_list.append({
                **meta,
                "img_b64": img_b64
            })
            payload = {**meta, "img_b64": img_b64, "total": total, "type": "slide"}
            yield f"data: {json.dumps(payload)}\n\n"

        if pdf_doc:
            pdf_doc.close()
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except:
                pass

        _slide_store[session_id] = store_list
        # Synchronize fallback states for streaming uploads using the single source of truth singleton
        from core.slide_store import set_latest_upload_sid, _current_slide
        set_latest_upload_sid(session_id)
        _current_slide[session_id] = 0
        
        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )

