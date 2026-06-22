# # ─────────────────────────────────────────────────────────────
# # ADD 1: In _execute_task_async(), add this elif before the else:
# # ─────────────────────────────────────────────────────────────

#         elif task_type == "SLIDE_CONTROL":
#             return await self._handle_slide_control(details)

# # ─────────────────────────────────────────────────────────────
# # ADD 2: New method — paste inside the BackgroundAgent class,
# #         after _handle_complex_calculation()
# # ─────────────────────────────────────────────────────────────

#     async def _handle_slide_control(self, details: str) -> str:
#         """
#         Parses a slide navigation command from natural language
#         and sends it to slide_server via HTTP POST.

#         Supported intents:
#           "next slide"            → {"action": "next"}
#           "previous / back"       → {"action": "prev"}
#           "first slide"           → {"action": "first"}
#           "last slide"            → {"action": "last"}
#           "go to slide 4"         → {"action": "goto", "index": 4}
#           "slide 2" / "slide two" → {"action": "goto", "index": 2}
#         """
#         import re

#         SLIDE_SERVER_URL = os.getenv("PILOT_SLIDE_SERVER", "http://127.0.0.1:8001")
#         text = details.lower().strip()

#         # ── Parse intent ──────────────────────────────────────
#         command = {"action": "next"}   # safe default

#         word_to_num = {
#             "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
#             "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
#             "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
#             "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
#             "nineteen": 19, "twenty": 20,
#         }

#         if any(w in text for w in ("previous", "back", "last time", "go back")):
#             command = {"action": "prev"}

#         elif any(w in text for w in ("first", "beginning", "start", "restart")):
#             command = {"action": "first"}

#         elif any(w in text for w in ("last", "final", "end")):
#             command = {"action": "last"}

#         else:
#             # "go to slide 4" / "slide four" / "jump to 3"
#             num_match = re.search(r"slide\s+(\d+)", text)
#             word_match = None
#             for word, num in word_to_num.items():
#                 if re.search(rf"\bslide\s+{word}\b", text):
#                     word_match = num
#                     break

#             if num_match:
#                 command = {"action": "goto", "index": int(num_match.group(1))}
#             elif word_match:
#                 command = {"action": "goto", "index": word_match}
#             else:
#                 # Default: forward
#                 command = {"action": "next"}

#         # ── Send to slide_server ──────────────────────────────
#         print(f"[BackgroundAgent] Slide command: {command}")
#         try:
#             result = post_json(
#                 f"{SLIDE_SERVER_URL}/slide/command",
#                 command,
#                 timeout=5.0
#             )
#             clients = result.get("clients_notified", 0)
#             action = command["action"]

#             if clients == 0:
#                 return "Slide command sent but no browser is connected. Please open the slides in your browser first."

#             # Natural TTS response per action
#             responses = {
#                 "next":  "Moving to the next slide.",
#                 "prev":  "Going back to the previous slide.",
#                 "first": "Jumping to the first slide.",
#                 "last":  "Jumping to the last slide.",
#                 "goto":  f"Going to slide {command.get('index', '?')}.",
#             }
#             return responses.get(action, "Slide navigated.")

#         except Exception as e:
#             print(f"[BackgroundAgent] Slide command failed: {e}")
#             return "I couldn't reach the slide server. Make sure slide_server.py is running."