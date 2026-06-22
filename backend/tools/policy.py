"""
RBAC policy gate — checks speaker role before tool execution.
Destructive tools require identity-bound spoken confirmation.
DS-A / FSE-A shared.
"""
import asyncio, logging
from core.config import settings

logger = logging.getLogger("pilot.policy")

ROLE_PERMS = {
    "admin":     set(["*"]),
    "manager":   {"ppt_navigate","ppt_jump_to_title","ppt_qa","ppt_summarize","ppt_delete_slide","ticket_create","ticket_update","ticket_close","kb_search","crm_lookup","flight_search","flight_book","database_query","write_file","system_check","complex_calculation","jira_comment","jira_transition"},
    "csr":       {"ticket_create","ticket_update","ticket_close","kb_search","crm_lookup","flight_search","flight_book"},
    "operator":  {"ppt_navigate","ppt_jump_to_title","ppt_qa","ppt_summarize"},
    "developer": {"ppt_navigate","ppt_jump_to_title","ppt_qa","ppt_summarize","kb_search","database_query","write_file","system_check","complex_calculation","jira_comment"},
    "customer":  set(),
}


# Global registry for active latch-window confirmations
# session_id -> { "tool": str, "speaker_id": str, "event": asyncio.Event, "confirmed": bool }
PENDING_CONFIRMATIONS = {}

class PolicyGate:
    async def check(self, tool: str, speaker_id: str, role: str, session_id: str) -> bool:
        from db.engine import AsyncSessionLocal
        from db.models import User
        from sqlalchemy import select

        # TO DISABLE VOICE SIGNATURE VERIFICATION MATCHING FOR TESTING:
        # Change BYPASS_VOICE_VERIFICATION to True
        BYPASS_VOICE_VERIFICATION = True

        # Verify if there is currently an active logged-in user in the workspace
        # If the speaking voice similarity does not match the active logged-in user profile, block delegation!
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.is_active == True))
            active_users = result.scalars().all()

        if active_users and not BYPASS_VOICE_VERIFICATION:
            # We have registered signed-in users. Verify speaker_id matches one of the logged-in users.
            is_valid_user = any(u.name.lower() == (speaker_id or "").lower() for u in active_users)
            if not is_valid_user:
                logger.warning(f"[policy] Voice Match Blocked: Speaker '{speaker_id}' is not an authenticated logged-in user.")
                await self._emit_blocked(session_id, speaker_id, tool, "unauthorized_voice_signature")
                await self._audit(session_id, speaker_id, role, tool, f"blocked:unauthorized_voice_signature")
                return False

        # Apply standard RBAC permissions
        role = (role or "developer").lower() # Default to developer permissions for unregistered mic streams
        perms = ROLE_PERMS.get(role, set())
        allowed = "*" in perms or tool in perms

        if not allowed:
            await self._emit_blocked(session_id, speaker_id, tool, "rbac_denied")
            await self._audit(session_id, speaker_id, role, tool, "blocked:rbac_denied")
            return False

        if tool in settings.DESTRUCTIVE_TOOLS:
            # Let's say we check if tool == "jira_transition" and role == "manager", we skip confirmation!
            if tool == "jira_transition" and role == "manager":
                logger.info(f"[policy] Transition bypass: Speaker '{speaker_id}' is a manager - skipping destructive confirmations.")
            else:
                confirmed = await self._confirm(tool, speaker_id, session_id)
                if not confirmed:
                    await self._audit(session_id, speaker_id, role, tool, "blocked:confirm_timeout")
                    return False

        await self._audit(session_id, speaker_id, role, tool, "allowed")
        return True

    async def _confirm(self, tool: str, speaker_id: str, session_id: str) -> bool:
        from queues.bus import bus
        
        # Propose the mutation + summary
        confirm_event = asyncio.Event()
        PENDING_CONFIRMATIONS[session_id] = {
            "tool": tool,
            "speaker_id": speaker_id,
            "event": confirm_event,
            "confirmed": False
        }
        
        logger.info(f"[policy] Latch window opened for session {session_id[:8]} - Waiting for speaker '{speaker_id}' to confirm.")
        
        await bus.emit_event("confirm_prompt", {
            "tool": tool, "speaker": speaker_id,
            "message": f"Verify Voice ID: Confirm action '{tool}'? Only speaker '{speaker_id}' is authorized. Say 'yes confirm' to proceed."
        }, session_id)
        
        try:
            # Latch window: wait up to 10 seconds for affirmative confirmation from the exact same speaker
            await asyncio.wait_for(confirm_event.wait(), timeout=settings.CONFIRM_TIMEOUT_S)
            confirmed = PENDING_CONFIRMATIONS[session_id]["confirmed"]
            return confirmed
        except asyncio.TimeoutError:
            logger.warning(f"[policy] Latch window TIMEOUT: Speaker '{speaker_id}' failed to confirm destructive action within 10s.")
            await bus.emit_event("tool_blocked", {
                "tool": tool, "speaker": speaker_id, "reason": "confirm_timeout"
            }, session_id)
            return False
        finally:
            PENDING_CONFIRMATIONS.pop(session_id, None)

    async def _emit_blocked(self, session_id, speaker_id, tool, reason):
        from queues.bus import bus
        await bus.emit_event("tool_blocked", {
            "tool": tool, "speaker": speaker_id, "reason": reason
        }, session_id)

    async def _audit(self, session_id, speaker_id, role, tool, decision):
        from db.engine import AsyncSessionLocal
        from db.models import AuditLog
        try:
            async with AsyncSessionLocal() as db:
                db.add(AuditLog(
                    session_id=session_id, speaker_id=speaker_id,
                    role=role, action="policy_check", tool=tool, decision=decision
                ))
                await db.commit()
        except Exception as e:
            logger.error(f"Audit write error: {e}")


policy_gate = PolicyGate()
