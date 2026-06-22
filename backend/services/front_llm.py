"""
Front LLM — Ollama primary, keyword fallback with full PPT navigation.
"""
import json, logging, time, re
from core.config import settings

logger = logging.getLogger("pilot.front_llm")

SYSTEM_PROMPT = """You are PILOT — a real-time voice AI copilot routing engine.

Output ONLY valid JSON — no other text:
{
  "action": "ignore" | "respond_now" | "delegate",
  "preamble": "<spoken reply ≤12 words, warm and human>",
  "tool": "<tool_name or null>",
  "args": {},
  "mode": "queue" | "interrupt"
}

PREAMBLE must sound human: "On it!", "Sure!", "Let me check.", "Got it!", "Right away!"

PPT TOOLS: ppt_navigate(direction:next|prev|first|last), ppt_jump_to_title(query,slide_number), ppt_qa(query,slide_number), ppt_summarize()
CARE TOOLS: ticket_create, ticket_update, ticket_close, kb_search(query), crm_lookup, flight_search, flight_book, database_query(query), write_file(query), system_check(query), complex_calculation(query)

INSTRUCTIONS: Route all general knowledge questions, chit-chat, greetings, or open-ended conversations DIRECTLY as "respond_now" (no tool, preamble contains the actual complete answer to the query). ONLY use "delegate" with "general_qa" or other tools for heavy programmatic background operations (slide control, flight search, writing files, system checks, database querying, etc.).

For general conversation, do NOT delegate — answer it directly inside the "preamble" block to minimize latency. Keep direct answers friendly and brief (1-3 sentences max)."""

# IGNORE: filler, noise, unclear, confidence<0.6, negated commands

_KEYWORDS = [
    # PPT navigation
    (["next slide","go forward","advance","next one"],
     {"action":"delegate","preamble":"Moving forward!","tool":"ppt_navigate","args":{"direction":"next"},"mode":"queue"}),
    (["previous slide","go back","back one","prev slide"],
     {"action":"delegate","preamble":"Going back!","tool":"ppt_navigate","args":{"direction":"prev"},"mode":"queue"}),
    (["first slide","go to start","beginning"],
     {"action":"delegate","preamble":"Back to the start!","tool":"ppt_navigate","args":{"direction":"first"},"mode":"queue"}),
    (["last slide","go to end","final slide","end slide"],
     {"action":"delegate","preamble":"Jumping to the end!","tool":"ppt_navigate","args":{"direction":"last"},"mode":"queue"}),
    # Greetings
    (["hello","hi pilot","hey pilot","good morning","good afternoon","hi there"],
     {"action":"respond_now","preamble":"Hey! I'm listening — what can I help with?","tool":None,"args":{},"mode":"queue"}),
    (["thank you","thanks","great","good job","well done"],
     {"action":"respond_now","preamble":"Happy to help! What else can I do?","tool":None,"args":{},"mode":"queue"}),
    # Knowledge / search
    (["search","look up","find","tell me about","what is","explain","describe"],
     {"action":"delegate","preamble":"Let me look that up!","tool":"general_qa","args":{},"mode":"queue"}),
    # Tickets
    (["create ticket","open ticket","new ticket","raise ticket","log issue"],
     {"action":"delegate","preamble":"Creating that ticket now.","tool":"ticket_create","args":{},"mode":"queue"}),
    # Flights and Travel
    (["book flight","find flight","search flight","fly to","flights from","hotel","room","stay","booking","lodging","train","rail","irctc","cab","taxi","uber","ola","rapido"],
     {"action":"delegate","preamble":"Checking that travel information for you!","tool":"flight_search","args":{},"mode":"queue"}),
    # CRM
    (["look up customer","find customer","customer details","crm"],
     {"action":"delegate","preamble":"Looking up that customer.","tool":"crm_lookup","args":{},"mode":"queue"}),
    # Database
    (["database","recordings","query database","show recordings","how many files in database"],
     {"action":"delegate","preamble":"Querying the database for you.","tool":"database_query","args":{},"mode":"queue"}),
    # Write File
    (["write python","write a python","write file","create a file","write script","generate code"],
     {"action":"delegate","preamble":"On it! Writing that file and generating the code in the background. Please wait while I process the script.","tool":"write_file","args":{},"mode":"queue"}),
    # Write Email
    (["write email","draft email","email template","create email"],
     {"action":"delegate","preamble":"On it! Drafting that email for you in the background. Let me compile the template.","tool":"write_email","args":{},"mode":"queue"}),
    # Send Email
    (["send email","send this email","send the email","send the mail","send mail","dispatch email","dispatch mail"],
     {"action":"delegate","preamble":"On it! Sending that drafted email for you in real-time. Please wait while I dispatch the SMTP message.","tool":"send_email","args":{},"mode":"queue"}),
    # System Check
    (["workspace files","system check","project files","list directory","check cpu","system stats"],
     {"action":"delegate","preamble":"Running a system check now.","tool":"system_check","args":{},"mode":"queue"}),
    # Complex Calculation
    (["calculate","math","calculation","prime number"],
     {"action":"delegate","preamble":"Starting that complex calculation now.","tool":"complex_calculation","args":{},"mode":"queue"}),
    # JIRA
    (["comment on jira","append comment","jira comment"],
     {"action":"delegate","preamble":"On it! Appending your update comment to JIRA.","tool":"jira_comment","args":{},"mode":"queue"}),
    (["move jira","transition jira","transition JIRA-42","move Forty-two to Done","slam JIRA-88","to Done","to QA"],
     {"action":"delegate","preamble":"On it! Initiating JIRA transition. Checking RBAC credentials...","tool":"jira_transition","args":{},"mode":"queue"}),
]


class FrontLLMProvider:
    def __init__(self):
        self._client = None

    def load(self):
        try:
            from groq import AsyncGroq
            if settings.GROQ_API_KEY:
                self._client = AsyncGroq(api_key=settings.GROQ_API_KEY)
                logger.info("Groq FrontLLM provider ready ✓ (using llama-3.1-8b-instant)")
            else:
                logger.warning("No GROQ_API_KEY found, FrontLLM fallback active")
        except Exception as e:
            logger.warning(f"Failed to load Groq FrontLLM: {e} — keyword fallback active")

    async def classify(self, text: str, speaker_id: str, role: str, context: list) -> dict:
        # Check Case 2: Verification matching
        # Check Case 2: Verification matching
        is_verified = (speaker_id is not None) and (speaker_id != "You") and (speaker_id != "unknown")

        print(f"\n⚡ [FRONT LLM] Classifying utterance: \"{text}\"")

        # ── Fast slide Q&A quick-intercept (MUST run first to prevent classification collisions on words like 'Explain slide number 8') ──
        user_clean = re.sub(r"[^\w\s]", "", text.lower()).strip()
        is_slide_qa = False
        if any(q in user_clean for q in ("explain", "describe", "tell", "read", "show", "summarize", "about", "content", "what is on")) and ("slide" in user_clean or "presentation" in user_clean or "powerpoint" in user_clean):
            is_slide_qa = True
        elif "presentation" in user_clean or "powerpoint" in user_clean:
            is_slide_qa = True
            
        if is_slide_qa:
            result = {
                "action": "delegate",
                "preamble": "Let me analyze the slides for you!",
                "tool": "ppt_qa",
                "args": {"query": text},
                "mode": "queue"
            }
            if is_verified:
                result["preamble"] = f"Hello {speaker_id}! " + result["preamble"]
            else:
                result["preamble"] = "Hello there! " + result["preamble"]
            print(f"⚡ [FRONT LLM INTERCEPT] Slide Q&A action: '{result['action']}' | Tool: '{result['tool']}'")
            return result

        # ── Fast slide navigation quick-intercept ──
        slide_commands = {
            "next", "next slide", "previous slide", "go back", "slide back",
            "last slide", "first slide", "slide number", "jump to slide", "back",
            "go to slide"
        }
        
        is_slide_cmd = False
        if user_clean in slide_commands:
            is_slide_cmd = True
        elif re.match(r"^(go\s+to\s+)?slide\s+(?:number\s+|no\s+|#\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$", user_clean):
            is_slide_cmd = True
        elif user_clean.startswith("go to slide ") or user_clean.startswith("jump to slide ") or "slide number" in user_clean:
            is_slide_cmd = True
            
        if is_slide_cmd:
            if "next" in user_clean:
                preamble = "Moving forward!"
                direction = "next"
            elif "back" in user_clean or "prev" in user_clean:
                preamble = "Going back!"
                direction = "prev"
            elif "first" in user_clean or "start" in user_clean:
                preamble = "Back to the start!"
                direction = "first"
            elif "last" in user_clean or "end" in user_clean:
                preamble = "Jumping to the end!"
                direction = "last"
            else:
                preamble = "Navigating slides!"
                direction = "next"
                
            m = re.search(r'\d+', user_clean)
            if m:
                num = int(m.group())
                result = {
                    "action": "delegate",
                    "preamble": f"Going to slide {num}!",
                    "tool": "ppt_jump_to_title",
                    "args": {"query": text, "slide_number": num - 1},
                    "mode": "queue"
                }
            else:
                word_to_num = {
                    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
                }
                found_num = None
                for word, num in word_to_num.items():
                    if f"slide {word}" in user_clean:
                        found_num = num
                        break
                if found_num is not None:
                    result = {
                        "action": "delegate",
                        "preamble": f"Going to slide {found_num}!",
                        "tool": "ppt_jump_to_title",
                        "args": {"query": text, "slide_number": found_num - 1},
                        "mode": "queue"
                    }
                else:
                    result = {
                        "action": "delegate",
                        "preamble": preamble,
                        "tool": "ppt_navigate",
                        "args": {"direction": direction},
                        "mode": "queue"
                    }

            if is_verified:
                result["preamble"] = f"Hello {speaker_id}! " + result["preamble"]
            else:
                result["preamble"] = "Hello there! " + result["preamble"]
            print(f"⚡ [FRONT LLM INTERCEPT] Slide navigation action: '{result['action']}' | Tool: '{result['tool']}'")
            return result

        # ── LLM CLASSIFICATION PROVIDER ROUTING ──
        provider = settings.FRONT_LLM_PROVIDER.lower() if hasattr(settings, "FRONT_LLM_PROVIDER") else "groq"
        
        # 1. OLLAMA LOCAL PROVIDER (Primary match to Capstone_project1_2_apna_vala)
        if provider == "ollama":
            import httpx
            url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            ctx_str = "\n".join(f"{c.get('speaker','?')}: {c.get('text','')}" for c in context[-5:])
            prompt = (
                f"Context of conversation:\n{ctx_str}\n\n"
                f"Speaker Identity: {speaker_id} (Role: {role})\n"
                f"Last spoken utterance: \"{text}\"\n\n"
                f"Match user commands explicitly. Format output strictly as JSON.\n"
                f"JSON schema requirements: {SYSTEM_PROMPT}"
            )
            
            # Setup list of preferred models with priority: qwen3.5:2b (or qwen3.5:3b) -> qwen3:8b (or default)
            preferred_models = [settings.OLLAMA_MODEL, "qwen3.5:2b" ,"qwen3.5:3b","qwen3:8b", "llama3.2:latest"]
            # Filter duplicates while maintaining order
            models_to_try = []
            for m in preferred_models:
                if m and m not in models_to_try:
                    models_to_try.append(m)
                    
            for idx, active_model in enumerate(models_to_try):
                payload = {
                    "model": active_model,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    "options": {
                        "temperature": 0.0
                    },
                    "format": "json"
                }
                try:
                    # Increased timeout to 120s to allow heavy local 8B models (Qwen) to complete inference without timing out
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        resp = await client.post(url, json=payload)
                        if resp.status_code == 200:
                            result_data = resp.json()
                            raw_content = result_data.get("message", {}).get("content", "").strip()
                            # Extract JSON safely
                            json_match = re.search(r"\{.*\}", raw_content, re.DOTALL)
                            if json_match:
                                result = json.loads(json_match.group(0))
                            else:
                                result = json.loads(raw_content)
                                
                            result = self._fill_args(result, text)
                            if is_verified:
                                if result.get("preamble"):
                                    result["preamble"] = f"Hello {speaker_id}! " + result["preamble"]
                            else:
                                if result.get("preamble"):
                                    result["preamble"] = "Hello there! " + result["preamble"]
                            print(f"✅ [FRONT LLM SUCCESS] Ollama ({active_model}) routed successfully! Action: '{result.get('action')}' | Preamble: \"{result.get('preamble')}\" | Tool: '{result.get('tool')}'")
                            return result
                except Exception as e:
                    print(f"⚠️ [FRONT LLM WARNING] Ollama model '{active_model}' failed/not found: {e}. Trying next available fallback model.")
                    logger.warning(f"Ollama FrontLLM model '{active_model}' failed: {e}")
                    # If this is the last model and it failed, let the exception cascade to the outer fallback
                    if idx == len(models_to_try) - 1:
                        logger.warning("All Ollama models failed, cascading to local keyword matching.")

        # Keyword fallback (Enforced strictly for local-only execution, bypassing OpenAI/Groq)
        result = self._keyword_fallback(text)
        if is_verified:
            if result.get("preamble"):
                result["preamble"] = f"Hello {speaker_id}! " + result["preamble"]
        else:
            if result.get("preamble"):
                result["preamble"] = "Hello there! " + result["preamble"]
        
        print(f"ℹ️ [FRONT LLM KEYWORDS] Keyword matching routed action: '{result.get('action')}' | Preamble: \"{result.get('preamble')}\"")
        # Ensure that if it is a general question and has no tool associated, we do NOT ignore/cut-off.
        # This will forward the classification decision to delegate/answer cleanly.
        return result

    def _fill_args(self, result: dict, text: str) -> dict:
        """Fill in missing args from the original text."""
        tool = result.get("tool")
        args = result.get("args", {})
        if tool in ("kb_search", "ppt_qa", "database_query", "write_file", "write_email", "system_check", "complex_calculation", "flight_search", "general_qa") and not args.get("query"):
            args["query"] = text
        if tool == "ticket_create" and not args.get("synopsis"):
            args["synopsis"] = text; args.setdefault("category","general"); args.setdefault("symptoms","")
        if tool == "ppt_jump_to_title" and not args.get("query"):
            args["query"] = text
        result["args"] = args
        return result

    def _keyword_fallback(self, text: str) -> dict:
        t = text.lower().strip()
        if len(t) < 3:
            return {"action":"ignore","preamble":None,"tool":None,"args":{},"mode":"queue"}

        # Slide Q&A check
        if ("slide" in t or "presentation" in t or "powerpoint" in t) and any(q in t for q in ("explain", "describe", "tell", "read", "show", "summarize", "about", "content", "what is on")):
            return {"action":"delegate","preamble":"Let me analyze the slides for you!",
                    "tool":"ppt_qa","args":{"query":text},
                    "mode":"queue"}

        # Slide number: "go to slide 42" / "slide forty two"
        m = re.search(r'\b(?:go to |open |jump to |slide )?slide[s]?\s+(\d+)\b', t)
        if m or re.search(r'\bslide\s+\d+\b', t):
            num = int(re.search(r'\d+', t).group())
            return {"action":"delegate","preamble":f"Going to slide {num}!",
                    "tool":"ppt_jump_to_title","args":{"query":text,"slide_number":num-1},
                    "mode":"queue"}

        for keywords, response in _KEYWORDS:
            if any(k in t for k in keywords):
                r = response.copy()
                r["args"] = dict(response["args"])
                if r.get("tool") in ("kb_search", "ppt_qa", "database_query", "write_file", "write_email", "system_check", "complex_calculation", "flight_search", "jira_comment", "jira_transition"):
                    r["args"]["query"] = text
                if r.get("tool") == "ticket_create":
                    r["args"] = {"category":"general","synopsis":text,"symptoms":""}
                return r

        # General knowledge question fallback — answer DIRECTLY inside the Front LLM to minimize latency!
        if len(t.split()) >= 3:
            return {"action":"respond_now",
                    "preamble":"Let me answer that directly for you! A conversational response will follow.",
                    "tool":None,"args":{},"mode":"queue"}
        return {"action":"ignore","preamble":None,"tool":None,"args":{},"mode":"queue"}


front_llm_provider = FrontLLMProvider()
