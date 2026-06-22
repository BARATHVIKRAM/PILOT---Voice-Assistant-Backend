import os
import json
import re
import urllib.request
import urllib.error
import asyncio

# Retrieve config from environment or default to pilot_asr.py settings
LLM_PROVIDER = os.getenv("PILOT_LLM_PROVIDER", "echo").lower()
LLM_MODEL = os.getenv("PILOT_LLM_MODEL", "llama3.2")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", LLM_MODEL)

CLASSIFIER_SYSTEM_PROMPT = """You are the Intent Classification and Conversation Router for PILOT, a voice assistant.
Your job is to analyze the user utterance and determine if it is a general conversation query or a specific background task.

You MUST respond ONLY with a valid JSON object matching this structure:
{
  "intent": "CONVERSATION" or "BACKGROUND_TASK",
  "response": "For CONVERSATION, provide a brief direct answer (1-2 sentences). For BACKGROUND_TASK, provide a short, natural voice acknowledgment saying you are starting the task in the background.",
  "task_type": "None" or "DATABASE_QUERY" or "WRITE_FILE" or "COMPLEX_CALCULATION" or "SYSTEM_CHECK" or "MCP_TOOL_QUERY" or "SLIDE_CONTROL",
  "task_details": "Extracted prompt or instructions for the background task, or null"
}

Guidelines:
- BACKGROUND_TASK: Anything requiring code generation/scripts, database queries/lookups, file management, or complex math/analysis, or external tool execution/lookup.
  - "DATABASE_QUERY": Any database interaction (e.g., "query the database", "show recordings", "how many files in database").
  - "WRITE_FILE": Writing scripts, creating files, or generating code (e.g., "write a python script to fetch weather", "create a file called list.txt").
  - "SYSTEM_CHECK": Listing workspace files, searching directories, checking system stats (e.g., "what files are in this project", "check CPU usage").
  - "COMPLEX_CALCULATION": Multi-step operations or heavy math (e.g., "calculate prime numbers up to 1000", "analyze this code").
  - "MCP_TOOL_QUERY": Any request requiring external tools, real-time lookups, flight prices, live weather, web search, or live API integration (e.g. "search for flights from Mumbai to Delhi", "what's the weather in Tokyo", "what are today's prices of flights").
- "SLIDE_CONTROL": Any slide navigation command (e.g., "next slide", "go back", "previous slide", "go to slide 3", "first slide", "last slide", "jump to slide 5", "back", "next").
- CONVERSATION: Any chit-chat, greetings, questions, or general knowledge (e.g., "how are you today", "who built you", "what is the capital of France").

DO NOT return any explanation, code fences, or preamble. Just return the JSON object."""

def post_json(url: str, payload: dict, headers: dict | None = None, timeout: float = 60.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            **(headers or {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}

def call_classifier_sync(user_text: str, speaker: str = "unknown") -> dict:
    user_lower = user_text.lower().strip()
    user_clean = re.sub(r"[^\w\s]", "", user_lower).strip()

    # Fast intercept for slide navigation commands to avoid LLM latency and misclassifications
    slide_commands = {
        "next", "next slide", "previous slide", "go back", "slide back",
        "last slide", "first slide", "slide number", "jump to slide", "back",
        "go to slide"
    }
    
    # Check if user says exact slide commands or patterns like "go to slide 4" / "slide 4"
    is_slide_cmd = False
    if user_clean in slide_commands:
        is_slide_cmd = True
    elif re.match(r"^(go\s+to\s+)?slide\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$", user_clean):
        is_slide_cmd = True
    elif user_clean.startswith("go to slide ") or user_clean.startswith("jump to slide "):
        is_slide_cmd = True
    # Fast intercept to route ANY questions about slides or presentation directly to the Slide Control background agent Q&A
    elif any(q in user_clean for q in ("explain", "describe", "tell", "read", "show", "summarize", "about", "content")) and "slide" in user_clean:
        is_slide_cmd = True
    elif "presentation" in user_clean or "powerpoint" in user_clean:
        is_slide_cmd = True

    if is_slide_cmd:
        # Determine appropriate spoken response
        if "next" in user_clean:
            resp = "Moving to the next slide."
        elif "back" in user_clean or "prev" in user_clean:
            resp = "Going back now."
        elif "first" in user_clean or "start" in user_clean:
            resp = "Jumping to the first slide."
        elif "last" in user_clean or "end" in user_clean:
            resp = "Jumping to the last slide."
        else:
            resp = "Let me look that up on your slides in the background."

        return {
            "intent": "BACKGROUND_TASK",
            "response": resp,
            "task_type": "SLIDE_CONTROL",
            "task_details": user_text
        }

    # if LLM_PROVIDER in {"echo", "mock", "none"}:
    #     # In mock mode, we do simple keyword routing
    #     user_lower = user_text.lower()
    #     if "database" in user_lower or "recordings" in user_lower:
    #         return {
    #             "intent": "BACKGROUND_TASK",
    #             "response": "Let me query the recordings database for you in the background.",
    #             "task_type": "DATABASE_QUERY",
    #             "task_details": user_text
    #         }
    #     elif "flight" in user_lower or "price" in user_lower or "weather" in user_lower or "search" in user_lower or "mumbai" in user_lower or "delhi" in user_lower:
    #         return {
    #             "intent": "BACKGROUND_TASK",
    #             "response": "I'm on it! I'll query our external MCP server to get that real-time information for you in the background.",
    #             "task_type": "MCP_TOOL_QUERY",
    #             "task_details": user_text
    #         }
    #     elif "script" in user_lower or "write file" in user_lower or "create a file" in user_lower or "write a python" in user_lower:
    #         return {
    #             "intent": "BACKGROUND_TASK",
    #             "response": "Sure thing! I will write that file in the background.",
    #             "task_type": "WRITE_FILE",
    #             "task_details": user_text
    #         }
    #     elif "files" in user_lower or "directory" in user_lower or "workspace" in user_lower:
    #         return {
    #             "intent": "BACKGROUND_TASK",
    #             "response": "I'll do a system check of the workspace files in the background.",
    #             "task_type": "SYSTEM_CHECK",
    #             "task_details": user_text
    #         }
    #     elif "calculate" in user_lower or "prime" in user_lower:
    #         return {
    #             "intent": "BACKGROUND_TASK",
    #             "response": "I am starting that complex calculation in the background.",
    #             "task_type": "COMPLEX_CALCULATION",
    #             "task_details": user_text
    #         }
        
    #     elif any(w in user_lower for w in ("next slide", "previous slide", "go to slide",
    #                                 "slide back", "last slide", "first slide",
    #                                 "slide number", "jump to slide", "back", "next")):
    #         return {
    #             "intent": "BACKGROUND_TASK",
    #             "response": "Navigating the slide for you.",
    #             "task_type": "SLIDE_CONTROL",
    #             "task_details": user_text
    #         }
    #     else:
    #         return {
    #             "intent": "CONVERSATION",
    #             "response": f"Mock PILOT Front Agent response to: {user_text}",
    #             "task_type": "None",
    #             "task_details": None
    #         }
    if LLM_PROVIDER in {"echo", "mock", "none"}:
        user_lower = user_text.lower()
        # Flight price, weather, search
        if "flight" in user_lower or "price" in user_lower or "weather" in user_lower or "search" in user_lower or "mumbai" in user_lower or "delhi" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "I'm on it! I'll query our external MCP server to get that real-time information for you in the background.",
                "task_type": "MCP_TOOL_QUERY",
                "task_details": {"serviceType": "flights", "query": user_text}
            }
        # Hotel booking customer care
        elif "hotel" in user_lower or "room" in user_lower or "booking" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "Starting your hotel customer care task in the background.",
                "task_type": "MCP_TOOL_QUERY",
                "task_details": {"serviceType": "hotels", "query": user_text}
            }
        # Train booking customer care
        elif "train" in user_lower or "rail" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "I'll query the train booking customer care for you in the background.",
                "task_type": "MCP_TOOL_QUERY",
                "task_details": {"serviceType": "trains", "query": user_text}
            }
        # Cab/taxi booking customer care
        elif "cab" in user_lower or "taxi" in user_lower or "ola" in user_lower or "uber" in user_lower or "rapido" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "I will contact the cab booking customer care in the background.",
                "task_type": "MCP_TOOL_QUERY",
                "task_details": {"serviceType": "cabs", "query": user_text}
            }
        # Existing tasks
        elif "database" in user_lower or "recordings" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "Let me query the recordings database for you in the background.",
                "task_type": "DATABASE_QUERY",
                "task_details": user_text
            }
        elif "script" in user_lower or "write file" in user_lower or "create a file" in user_lower or "write a python" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "Sure thing! I will write that file in the background.",
                "task_type": "WRITE_FILE",
                "task_details": user_text
            }
        elif "files" in user_lower or "directory" in user_lower or "workspace" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "I'll do a system check of the workspace files in the background.",
                "task_type": "SYSTEM_CHECK",
                "task_details": user_text
            }
        elif "calculate" in user_lower or "prime" in user_lower:
            return {
                "intent": "BACKGROUND_TASK",
                "response": "I am starting that complex calculation in the background.",
                "task_type": "COMPLEX_CALCULATION",
                "task_details": user_text
            }
        elif any(w in user_lower for w in ("next slide", "previous slide", "go to slide",
                                    "slide back", "last slide", "first slide",
                                    "slide number", "jump to slide", "back", "next")):
            return {
                "intent": "BACKGROUND_TASK",
                "response": "Navigating the slide for you.",
                "task_type": "SLIDE_CONTROL",
                "task_details": user_text
            }
        else:
            return {
                "intent": "CONVERSATION",
                "response": f"Mock PILOT Front Agent response to: {user_text}",
                "task_type": "None",
                "task_details": None
            }


    if LLM_PROVIDER == "ollama":
        payload = {
            "model": LLM_MODEL,
            "stream": False,
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
                {"role": "user", "content": f"User: {user_text}"},
            ],
            "options": {
                "temperature": 0.0 # Low temperature for reliable formatting
            }
        }
        try:
            result = post_json(OLLAMA_URL, payload, timeout=120.0)
            raw_content = result.get("message", {}).get("content", "").strip()
        except Exception as exc:
            raise RuntimeError(f"Ollama classification failed: {exc}")

    elif LLM_PROVIDER == "openai":
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is required when PILOT_LLM_PROVIDER=openai")
        payload = {
            "model": OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
                {"role": "user", "content": f"User: {user_text}"},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"}
        }
        try:
            result = post_json(
                f"{OPENAI_BASE_URL.rstrip('/')}/chat/completions",
                payload,
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                timeout=120.0,
            )
            raw_content = result["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            raise RuntimeError(f"OpenAI classification failed: {exc}")
    else:
        raise RuntimeError(f"Unsupported LLM provider: {LLM_PROVIDER}")

    # Extract and parse JSON robustly
    try:
        # Look for any JSON pattern
        json_match = re.search(r"\{.*\}", raw_content, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group(0))
            return parsed
        else:
            # Fallback
            return json.loads(raw_content)
    except Exception as e:
        print(f"[FrontAgent] Error parsing classification JSON: {e}. Raw content was: {raw_content}")
        # Safe fallback
        return {
            "intent": "CONVERSATION",
            "response": "I encountered an error classifying your intent, but I'm happy to chat! How can I help?",
            "task_type": "None",
            "task_details": None
        }

async def call_classifier(user_text: str, speaker: str = "unknown") -> dict:
    return await asyncio.to_thread(call_classifier_sync, user_text, speaker)
