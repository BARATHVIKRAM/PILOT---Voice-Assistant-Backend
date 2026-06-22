"""
Enrollment API — mic recording + file upload → embedding → identity
Features: start, submit audio (mic or file), finalize, list, delete
"""
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from db.engine import get_db
from db.models import VoiceEnrollment
import asyncio, logging

router = APIRouter()
logger = logging.getLogger("pilot.enrollment")


class StartReq(BaseModel):
    name: str
    role: str


@router.get("")
async def list_speakers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(VoiceEnrollment).where(VoiceEnrollment.status == "ready")
    )).scalars().all()
    return [{"id": r.id, "name": r.speaker_name, "role": r.role,
             "voice_id": f"#{r.id:06X}"} for r in rows]


@router.post("/start")
async def start(req: StartReq, db: AsyncSession = Depends(get_db)):
    e = VoiceEnrollment(user_id=None, speaker_name=req.name, role=req.role)
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return {"speaker_id": e.id, "name": req.name, "role": req.role}


from typing import List

@router.post("/audio")
async def submit_audio(
    speaker_id: str = Form(...),
    audio: List[UploadFile] = File(...),
    email: str = Form(None),
    db: AsyncSession = Depends(get_db)
):
    """Accepts multiple mic recordings (webm/wav), selects the best one, and creates User."""
    e = (await db.execute(
        select(VoiceEnrollment).where(VoiceEnrollment.id == int(speaker_id))
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Enrollment not found")

    # Extract embeddings for all 3 uploaded audio segments and calculate the Average (Mean) embedding vector
    from services.enrollment import embed_provider
    import numpy as np

    embeddings = []
    for aud in audio:
        bytes_data = await aud.read()
        if len(bytes_data) < 1000:
            continue
        try:
            # Extract embedding from each audio pass
            emb = await asyncio.to_thread(embed_provider.extract, bytes_data)
            embeddings.append(emb)
        except Exception as ex:
            logger.warning(f"Failed to extract embedding from a registration pass: {ex}")

    if not embeddings:
        raise HTTPException(400, "No valid audio samples received or failed to extract embeddings")

    # Compute the average (mean) embedding vector to generalize pitch, resonance and prosody
    final_embedding = np.mean(embeddings, axis=0).astype(np.float32)
    emb_bytes = final_embedding.tobytes()

    # Create VoiceEnrollment directories
    os.makedirs("data/embeddings", exist_ok=True)
    npy_path = f"data/embeddings/speaker_{speaker_id}.npy"
    np.save(npy_path, final_embedding)

    # Check if this email corresponds to a pending signup session
    from api.auth import PENDING_SIGNUPS
    from db.models import User
    
    if email and email in PENDING_SIGNUPS:
        pending = PENDING_SIGNUPS.pop(email)
        user = User(
            name=pending["name"],
            email=pending["email"],
            hashed_pw=pending["hashed_pw"],
            role=pending["role"],
            is_active=True,
            embedding=emb_bytes  # Best voice embedding saved directly as BLOB in SQLite users table
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        e.user_id = user.id
        logger.info(f"Pending user '{user.email}' registered successfully with ID={user.id} and best voice embedding.")

    e.embedding = emb_bytes
    e.npy_path = npy_path
    e.status = "ready"
    await db.commit()
    voice_id = f"#{int(speaker_id):06X}"
    logger.info(f"Enrollment complete: {e.speaker_name} → {voice_id}")
    return {"status": "ready", "speaker_id": speaker_id, "voice_id": voice_id}


@router.post("/finalize/{speaker_id}")
async def finalize(speaker_id: int, db: AsyncSession = Depends(get_db)):
    e = (await db.execute(
        select(VoiceEnrollment).where(VoiceEnrollment.id == speaker_id)
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404)
    e.status = "ready"
    await db.commit()
    return {"status": "ready", "voice_id": f"#{speaker_id:06X}"}


@router.delete("/{speaker_id}")
async def delete(speaker_id: int, db: AsyncSession = Depends(get_db)):
    e = (await db.execute(
        select(VoiceEnrollment).where(VoiceEnrollment.id == speaker_id)
    )).scalar_one_or_none()
    if e:
        await db.delete(e)
        await db.commit()
    return {"status": "deleted"}
