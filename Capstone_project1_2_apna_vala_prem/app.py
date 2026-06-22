from fastapi import FastAPI, UploadFile, File, Form
from sqlalchemy import create_engine, text
import shutil
import os

app = FastAPI()

# Retrieve DATABASE_URL from environment or fallback to portable local SQLite database
DATABASE_URL = os.getenv("PILOT_DATABASE_URL", "sqlite:///pilot_voice.db")

engine = create_engine(DATABASE_URL)

# Automatically initialize SQLite table structure if using local sqlite setup
if DATABASE_URL.startswith("sqlite"):
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT,
                prompt_text TEXT,
                recording_number INTEGER,
                audio_path TEXT
            )
        """))
        print("[App] Local SQLite table 'recordings' verified/created.")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.post("/upload")
async def upload_audio(
    user_name: str = Form(...),
    prompt_text: str = Form(...),
    recording_number: int = Form(...),
    audio: UploadFile = File(...)
):

    filename = (
        f"{user_name}_{recording_number}.webm"
    )

    path = os.path.join(
        UPLOAD_DIR,
        filename
    )

    with open(path, "wb") as buffer:
        shutil.copyfileobj(
            audio.file,
            buffer
        )

    with engine.begin() as conn:

        conn.execute(
            text("""
                INSERT INTO recordings
                (
                    user_name,
                    prompt_text,
                    recording_number,
                    audio_path
                )
                VALUES
                (
                    :user_name,
                    :prompt_text,
                    :recording_number,
                    :audio_path
                )
            """),
            {
                "user_name": user_name,
                "prompt_text": prompt_text,
                "recording_number": recording_number,
                "audio_path": path,
            },
        )

    return {"status": "saved"}