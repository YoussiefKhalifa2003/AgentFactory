"""Automatic critic desk: inject a second pair of eyes, retry on high findings."""

from __future__ import annotations

import re
from typing import Any

import db
import sandbox

SERIOUS = {"coding", "maths", "qa"}
CHAIN_MAX = 7
RETRY_MAX = 2
CRITIC_PROMPT = (
    "You are the critic. The product files are already on this desk. Call list_files, then write "
    "critic.md as Verdict plus Findings with severity high, block, or low. If the game or site is "
    "playable, call capture_view and click_view on Start. Do not rewrite the product."
)


def critic_prompt(original: str = "") -> str:
    job = (original or "").strip()
    if not job or "You are the critic" in job:
        return CRITIC_PROMPT
    extra = (
        f" Original request:\n{job[:2000]}\n"
        "Fail with severity high if the files shrink that request into a toy demo. "
    )
    try:
        import local as product

        if product.wants_fps(job):
            extra += (
                "This was an FPS / CSGO-like request. Fail high if the game is a top-down square "
                "or is missing WASD, mouse look, click-to-shoot, a map, or a HUD. "
            )
        extra += (
            "Fail high if View stays on a loading overlay, or if js/main.js / script.js "
            "does not parse (SyntaxError). "
        )
    except Exception:
        pass
    return CRITIC_PROMPT + extra


def _original_request(chain: dict[str, Any]) -> str:
    item_id = chain.get("item_id")
    if item_id:
        try:
            item = db.get_item(str(item_id))
        except Exception:
            item = None
        if item:
            text = (item.get("text") or item.get("prompt") or "").strip()
            if text and "You are the critic" not in text:
                return text
    for step in chain.get("steps") or []:
        body = (step.get("prompt") or "").strip()
        if (
            body
            and "You are the critic" not in body
            and not body.startswith("Fix the critic")
        ):
            return body
    return ""


HIGH = re.compile(
    r"(?im)(\*\*(high|block|blocker)\*\*|severity\s*[:=]\s*(high|block)|"
    r"^#{0,3}\s*verdict\b.*\b(fail|block|reject|do not ship))"
)


def is_critic_step(step: dict[str, Any] | None) -> bool:
    if not step:
        return False
    return "You are the critic" in (step.get("prompt") or "")


def critic_has_high(text: str) -> bool:
    return bool(HIGH.search(text or ""))


def _prefs(strength: str) -> list[str]:
    if strength == "coding":
        return ["qa", "review", "coding"]
    if strength == "maths":
        return ["maths", "review"]
    if strength == "qa":
        return ["review"]
    return ["review"]


def _strength_for(agent: dict[str, Any], prefs: list[str]) -> str:
    have = agent.get("strengths") or []
    for skill in prefs:
        if skill in have:
            return skill
    return have[0] if have else "review"


def pick_critic(producer_id: str | None, strength: str) -> dict[str, Any] | None:
    prefs = _prefs(strength)
    idle: list[dict[str, Any]] = []
    for agent in db.list_agents():
        if producer_id and agent["id"] == producer_id:
            continue
        if db.agent_busy(agent["id"]):
            continue
        idle.append(agent)
    for skill in prefs:
        for agent in idle:
            if skill in (agent.get("strengths") or []):
                return agent
    return idle[0] if idle else None


def already_has_critic(steps: list[dict[str, Any]]) -> bool:
    if not steps:
        return False
    last = steps[-1]
    if is_critic_step(last):
        return True
    if (last.get("strength") or "") not in {"review", "qa"}:
        return False
    last_id = last.get("agent_id")
    if not last_id:
        return False
    prior_ids = {s.get("agent_id") for s in steps[:-1] if s.get("agent_id")}
    return last_id not in prior_ids or (len(steps) >= 2 and last_id != steps[-2].get("agent_id"))


def inject_steps(steps: list[dict[str, Any]], _prompt: str = "") -> list[dict[str, Any]]:
    out = [dict(s) for s in steps]
    if not out or already_has_critic(out):
        return out
    serious = [i for i, s in enumerate(out) if (s.get("strength") or "") in SERIOUS]
    if not serious:
        return out
    is_split = any(not bool(s.get("inherit", True)) for s in out[1:])
    if is_split:
        targets = list(serious)
        room = CHAIN_MAX - len(out)
        if len(targets) > room:
            targets = [serious[-1]] if room >= 1 else []
    else:
        targets = [serious[-1]] if len(out) < CHAIN_MAX else []
    added: list[dict[str, Any]] = []
    for i in targets:
        if len(out) + len(added) >= CHAIN_MAX:
            break
        producer = out[i]
        critic = pick_critic(producer.get("agent_id"), producer.get("strength") or "coding")
        if not critic:
            continue
        added.append(
            {
                "agent_id": critic["id"],
                "strength": _strength_for(critic, _prefs(producer.get("strength") or "coding")),
                "prompt": critic_prompt(_prompt),
                "depends_on": i + 1,
                "inherit": True,
            }
        )
    return out + added


def read_critic_text(agent_id: str, job_id: str) -> str:
    ws = sandbox.workspace(agent_id, job_id)
    files = sandbox.list_files(ws)
    for name in ("critic.md", "review.md"):
        if name in files:
            return sandbox.read_file(ws, name)
    return ""


def maybe_retry(chain: dict[str, Any], step: dict[str, Any], job: dict[str, Any]) -> bool:
    if not is_critic_step(step):
        return False
    retries = int(chain.get("retry_count") or 0)
    if retries >= RETRY_MAX:
        return False
    text = read_critic_text(str(job["agent_id"]), str(job["id"]))
    if not critic_has_high(text):
        return False
    seq = int(step.get("seq") or 0)
    producer = None
    for prior in chain.get("steps") or []:
        if int(prior.get("seq") or 0) == int(step.get("depends_on") or 0):
            producer = prior
            break
        if int(prior.get("seq") or 0) == seq - 1:
            producer = prior
    if not producer or not producer.get("agent_id"):
        return False
    if len(chain.get("steps") or []) >= CHAIN_MAX:
        return False
    original = _original_request(chain)
    fix = (
        "Fix the critic findings. Open critic.md and the inherited files. "
        "Write the complete corrected files. Match the original request"
        + (f":\n{original[:1500]}" if original else ".")
        + " Do not ship a smaller substitute."
    )
    db.update_chain_step(str(step["id"]), status="done")
    db.update_chain(str(chain["id"]), retry_count=retries + 1)
    db.append_chain_step(
        str(chain["id"]),
        {
            "agent_id": producer["agent_id"],
            "strength": producer.get("strength") or "coding",
            "prompt": fix,
            "depends_on": seq,
            "inherit": True,
        },
    )
    fix_seq = len(chain.get("steps") or []) + 1
    if retries + 1 < RETRY_MAX and fix_seq < CHAIN_MAX:
        eyes = pick_critic(producer.get("agent_id"), producer.get("strength") or "coding")
        if eyes:
            db.append_chain_step(
                str(chain["id"]),
                {
                    "agent_id": eyes["id"],
                    "strength": _strength_for(eyes, _prefs(producer.get("strength") or "coding")),
                    "prompt": critic_prompt(original),
                    "depends_on": fix_seq,
                    "inherit": True,
                },
            )
    return True


def cancel_dependents(job: dict[str, Any]) -> None:
    chain_id = job.get("chain_id")
    if not chain_id:
        return
    chain = db.get_chain(str(chain_id))
    if not chain:
        return
    step = db.step_for_job(job["id"]) or db.get_chain_step(str(job.get("chain_step_id") or ""))
    seq = int((step or {}).get("seq") or 0)
    changed = False
    for other in chain.get("steps") or []:
        if other.get("status") != "pending":
            continue
        if int(other.get("depends_on") or 0) == seq or is_critic_step(other):
            db.update_chain_step(other["id"], status="cancelled")
            changed = True
    if changed:
        db.update_chain(str(chain_id), status="cancelled")
