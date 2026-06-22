"""
PILOT JIRA concurrent supervisors — drafts and dispatches issues in real-time.
"""
import logging, json, os, uuid, asyncio
from core.config import settings

logger = logging.getLogger("pilot.tools.jira")

# Local Mock Database of JIRA issues for offline demo
_MOCK_JIRA_DB = {
    "JIRA-42": {
        "id": "JIRA-42",
        "title": "Auth module integration with JIRA metrics",
        "status": "In Progress",
        "comments": []
    },
    "JIRA-88": {
        "id": "JIRA-88",
        "title": "Database connection pooling optimization",
        "status": "In Progress",
        "comments": []
    }
}

async def jira_comment(args: dict, session_id: str) -> dict:
    """Appends notes/comments to a JIRA issue."""
    issue_id = args.get("issue_id") or args.get("id") or "JIRA-42"
    comment = args.get("comment") or args.get("summary") or args.get("query") or "Auth module landed for JIRA-42."
    
    issue_id = issue_id.upper().strip()
    
    if issue_id not in _MOCK_JIRA_DB:
        _MOCK_JIRA_DB[issue_id] = {
            "id": issue_id,
            "title": f"External synced issue {issue_id}",
            "status": "In Progress",
            "comments": []
        }
        
    # Simulate transactional stages with potential interruptions/rollbacks
    logger.info(f"[jira] Transactional write stage 1: Acquiring lock for {issue_id}")
    await asyncio.sleep(0.4)
    
    logger.info(f"[jira] Transactional write stage 2: Opening database write stream")
    await asyncio.sleep(0.4)
    
    # Check if interruption happened
    from core.session_state import get_state
    state = get_state(session_id)
    if state.barge_in:
        logger.warning(f"[jira] TRANSACTION INTERRUPTED mid-run! Rolling back stage 1 and 2 write operations safely.")
        return {"status": "cancelled", "message": "Transaction rolled back due to user interruption."}

    _MOCK_JIRA_DB[issue_id]["comments"].append(comment)
    logger.info(f"[jira] Transactional write stage 3: Commited comment to {issue_id}")
    
    spoken = f"I have successfully persisted comment to {issue_id}. The comment reads: {comment}"
    return {
        "status": "ok",
        "issue_id": issue_id,
        "comment_id": f"C-{str(uuid.uuid4())[:4].upper()}",
        "comment": comment,
        "issue": _MOCK_JIRA_DB[issue_id],
        "spoken_reply": spoken
    }

async def jira_transition(args: dict, session_id: str) -> dict:
    """Transitions a JIRA issue state."""
    issue_id = args.get("issue_id") or args.get("id") or "JIRA-42"
    status = args.get("status") or args.get("to") or "Done"
    
    issue_id = issue_id.upper().strip()
    status = status.title().strip()
    
    if issue_id not in _MOCK_JIRA_DB:
        _MOCK_JIRA_DB[issue_id] = {
            "id": issue_id,
            "title": f"External synced issue {issue_id}",
            "status": "In Progress",
            "comments": []
        }

    # Simulate transactional stages with potential interruptions/rollbacks
    logger.info(f"[jira] Transactional status transition stage 1: Acquiring lock for {issue_id}")
    await asyncio.sleep(0.4)
    
    from core.session_state import get_state
    state = get_state(session_id)
    if state.barge_in:
        logger.warning(f"[jira] TRANSACTION INTERRUPTED mid-run! Rolling back JIRA state safely.")
        return {"status": "cancelled", "message": "Transaction rolled back due to user interruption."}

    _MOCK_JIRA_DB[issue_id]["status"] = status
    logger.info(f"[jira] Transactional status transition stage 2: Flipped status of {issue_id} to {status}")
    
    spoken = f"Successfully updated JIRA issue status for {issue_id} to {status}."
    return {
        "status": "ok",
        "issue_id": issue_id,
        "status_field": status,
        "issue": _MOCK_JIRA_DB[issue_id],
        "spoken_reply": spoken
    }





