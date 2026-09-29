"""Desk checks that do not need a model: a page, a game, and a plan."""

from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

import db  # noqa: E402
import harness  # noqa: E402
import lists  # noqa: E402
import local  # noqa: E402
import memory  # noqa: E402
import repos  # noqa: E402
import sandbox  # noqa: E402
import slides  # noqa: E402


PAGE = """<!DOCTYPE html>
<html><head><link rel="stylesheet" href="styles.css"></head>
<body><button id="start-btn">Start</button><canvas id="gameCanvas" width="800" height="600"></canvas>
<script src="script.js"></script></body></html>
"""
CSS = ".hidden{display:none} button{cursor:pointer} body{margin:0;background:#111;color:#fff}"
JS = """
const start = document.getElementById("start-btn");
start.addEventListener("click", () => start.classList.add("hidden"));
"""
PLAN = '{"name":"write_file","arguments":{"path":"plan.md","content":"1. Open the list.\\n2. Assign the desk.\\n3. Review the file."}}'


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        ws = Path(raw)
        sandbox.write_file(ws, "index.html", PAGE)
        sandbox.write_file(ws, "styles.css", CSS)
        sandbox.write_file(ws, "script.js", JS)
        if local.site_gap(ws):
            print("website gap", local.site_gap(ws))
            return 1
        page = local.playable_page(ws, sandbox.read_file(ws, "index.html"), base="http://127.0.0.1:8000/site/")
        if "styles.css" not in page or "script.js" not in page:
            print("view dropped css or js")
            return 1
        if "desk-game" in page:
            print("view replaced a finished script")
            return 1
        if not local.js_looks_complete(JS) or "start-btn" not in JS:
            print("game script is not wired")
            return 1
        broken = ws / "script.js"
        broken.write_text("function start(){ if (true) {", encoding="utf-8")
        gap = local.site_gap(ws)
        if not gap or "script.js" not in gap:
            print("cut-off script was accepted", gap)
            return 1

    plan = harness._text_from_slop(PLAN)
    if "Assign the desk" not in plan:
        print("plan text was dropped", plan)
        return 1
    if harness._use_tools({"strengths": ["planning"]}, "Write a plan"):
        print("planning received tools")
        return 1
    if harness._use_tools({"strengths": ["brief"]}, "Write a brief"):
        print("brief received tools")
        return 1
    if harness._use_tools({"strengths": ["writing"]}, "Draft an email"):
        print("writing received tools")
        return 1
    if not harness._use_tools({"strengths": ["writing", "slides"]}, "Make a deck"):
        print("slides should get tools")
        return 1
    if not harness._use_tools({"strengths": ["review"]}, "Review this"):
        print("review should get tools")
        return 1
    if not harness._use_tools({"strengths": ["qa"]}, "Write tests"):
        print("qa should get tools")
        return 1
    pin = harness._system_prompt(
        {"name": "Rex", "strengths": ["review", "pdf"], "instructions": "", "description": ""}
    )
    if "PRIMARY SKILL" not in pin or "This is a review job" not in pin:
        print("primary review pack missing")
        return 1
    if "a review specialist" not in pin:
        print("review specialist line missing")
        return 1

    raw_deck = """<style>.ugly{color:purple}</style>
<section class="slide"><h2>One</h2><ul><li>A</li></ul></section>
<section class="slide"><h2>Two</h2></section>
"""
    wrapped = slides.wrap_deck(raw_deck)
    if slides.MARKER not in wrapped:
        print("deck missing marker")
        return 1
    if "--paper:" not in wrapped or "Georgia" not in wrapped:
        print("deck missing template css")
        return 1
    if wrapped.lower().count("<section") != 2:
        print("deck lost sections", wrapped.lower().count("<section"))
        return 1
    if ".ugly" in wrapped or "purple" in wrapped:
        print("deck kept model css")
        return 1
    again = slides.wrap_deck(wrapped)
    if again.count(slides.MARKER) != 1:
        print("deck nested", again.count(slides.MARKER))
        return 1
    if again.lower().count("<section") != 2:
        print("second wrap lost sections")
        return 1

    async def _write_pages(ws: Path) -> str | None:
        await harness._call_tool(ws, "write_file", {"path": "index.html", "content": PAGE})
        page_body = sandbox.read_file(ws, "index.html")
        if slides.MARKER in page_body or "--paper:" in page_body:
            return "index.html was wrapped"
        if "start-btn" not in page_body:
            return "index.html lost"
        await harness._call_tool(ws, "write_file", {"path": "slides.html", "content": raw_deck})
        deck_body = sandbox.read_file(ws, "slides.html")
        if slides.MARKER not in deck_body:
            return "slides.html not wrapped"
        return None

    with tempfile.TemporaryDirectory() as deck_raw:
        note = asyncio.run(_write_pages(Path(deck_raw)))
        if note:
            print(note)
            return 1

    with tempfile.TemporaryDirectory() as skill_raw:
        skill_ws = Path(skill_raw)
        ok, _ = harness._verify({"strengths": ["qa"]}, skill_ws, "tests", "looks good")
        if ok:
            print("qa passed without tests")
            return 1
        sandbox.write_file(skill_ws, "test_main.py", "print('OK')")
        ok, note = harness._verify({"strengths": ["qa"]}, skill_ws, "tests", "ok")
        if not ok:
            print("qa should pass when tests run", note)
            return 1
        ok, _ = harness._verify(
            {"strengths": ["review"]},
            skill_ws,
            "review",
            "## Verdict\nShip.\n## Findings\n1. **nit** — none. No issues.\n",
        )
        if not ok:
            print("review should pass on findings")
            return 1
        ok, _ = harness._verify(
            {"strengths": ["brief"]},
            skill_ws,
            "brief",
            "## Situation\nShipped.\n## So-what\nWe can demo.\n## Ask\nApprove Friday.\n## Next\nSend the deck.\n",
        )
        if not ok:
            print("brief should pass on the four headings")
            return 1

    import meetings

    if meetings._suggest_strength("code review the PR") != "review":
        print("suggest review failed")
        return 1
    if meetings._suggest_strength("write tests for coverage") != "qa":
        print("suggest qa failed")
        return 1
    if meetings._suggest_strength("status update for leadership") != "brief":
        print("suggest brief failed")
        return 1

    db.init_db()
    storm = db.create_project(
        {
            "name": "Stormcast",
            "organization": "example",
            "project": "Stormcast",
            "repository": "app",
            "branch": "main",
        }
    )
    other = db.create_project(
        {
            "name": "Other",
            "organization": "example",
            "project": "Other",
            "repository": "app",
            "branch": "main",
        }
    )
    try:
        root = repos.cache_dir(storm["id"])
        (root / ".git").mkdir(exist_ok=True)
        (root / "src").mkdir(exist_ok=True)
        (root / "src" / "app.py").write_text("def storm():\n    return 1\n", encoding="utf-8")
        db.remember(
            project_id=storm["id"],
            job_id="cade-job",
            agent_id="cade",
            agent_name="Cade",
            task="Code the Stormcast parser",
            status="done",
            body="Cade wrote the parser in src/app.py",
            files=["src/app.py"],
        )
        agents = db.list_agents()
        ada = agents[0] if agents else None
        now = db.utcnow()
        if ada:
            with db._lock:
                con = db.connect()
                con.execute("DELETE FROM jobs WHERE id IN ('floor-storm', 'floor-other')")
                con.execute(
                    """
                    INSERT INTO jobs (
                        id, agent_id, prompt, status, activity, caption, output,
                        created_at, updated_at, project_id
                    ) VALUES (?, ?, ?, 'thinking', 'thinking', ?, '', ?, ?, ?)
                    """,
                    ("floor-storm", ada["id"], "x", "Stormcast floor check", now, now, storm["id"]),
                )
                con.execute(
                    """
                    INSERT INTO jobs (
                        id, agent_id, prompt, status, activity, caption, output,
                        created_at, updated_at, project_id
                    ) VALUES (?, ?, ?, 'thinking', 'thinking', ?, '', ?, ?, ?)
                    """,
                    ("floor-other", ada["id"], "y", "ERDC floor check", now, now, other["id"]),
                )
                con.commit()
                con.close()
        agent = {"id": "hamza", "name": "Hamza", "strengths": ["writing"], "instructions": "", "description": ""}
        prompt = harness._system_prompt(agent, db.get_project(storm["id"]), "hamza-job")
        if "Project: Stormcast" not in prompt or "Earlier on this project" not in prompt or "Cade" not in prompt:
            print("stormcast prompt missing memory", prompt[:400])
            return 1
        if "On the floor right now" not in prompt or "Stormcast floor check" not in prompt:
            print("stormcast prompt missing floor recap", prompt[:400])
            return 1
        if "ERDC floor check" in prompt:
            print("stormcast prompt saw the other floor")
            return 1
        other_prompt = harness._system_prompt(agent, db.get_project(other["id"]), "")
        if "Cade" in other_prompt:
            print("other project saw Cade")
            return 1
        if "Stormcast floor check" in other_prompt:
            print("other project saw Stormcast floor")
            return 1
        if "apps/api/.env" not in repos.MISSING_PAT:
            print("pat copy should name the env file")
            return 1
        if repos.read_file(storm["id"], "../.env") != "error: path refused":
            print("path escape was allowed")
            return 1
        if "path refused" not in repos.read_file(storm["id"], "C:/Windows/win.ini"):
            print("absolute path was allowed")
            return 1
        import os

        os.environ["AZURE_DEVOPS_PAT"] = "secret-token-value"
        if "secret-token-value" in prompt:
            print("token leaked into the prompt")
            return 1
        before = len(db.list_memories(storm["id"], limit=20))
        memory.remember_job({"id": "x", "project_id": "", "prompt": "hi"}, agent, "answer", [])
        if len(db.list_memories(storm["id"], limit=20)) != before:
            print("memory written without a project")
            return 1

        agent_row = (db.list_agents() or [None])[0]
        if agent_row:
            job = db.create_job(agent_row["id"], "write a page")
            ws = sandbox.workspace(agent_row["id"], job["id"])
            sandbox.write_file(ws, "index.html", PAGE)
            harness._collect_artifacts(job, agent_row, ws, lambda _p: None)
            sandbox.write_file(ws, "index.html", PAGE + "<!-- again -->")
            harness._collect_artifacts(job, agent_row, ws, lambda _p: None)
            names = [row["name"] for row in db.list_artifacts(job["id"])]
            if names.count("index.html") != 1 or not names:
                print("artifact upsert failed", names)
                return 1
            with db._lock:
                con = db.connect()
                con.execute("DELETE FROM artifacts WHERE job_id=?", (job["id"],))
                con.execute("DELETE FROM jobs WHERE id=?", (job["id"],))
                con.commit()
                con.close()
            shutil.rmtree(ws, ignore_errors=True)

        import chains as crew
        import foreman as boss

        src = sandbox.workspace("cade", "j-src")
        sandbox.write_file(src, "plan.md", "1. research\n2. page")
        sandbox.write_file(src, "pack.md", "notes")
        crew.inherit_workspace("cade", "j-src", "hamza", "j-dst")
        dest = sandbox.workspace("hamza", "j-dst")
        if not (dest / "plan.md").exists() or not (dest / "pack.md").exists():
            print("inherit missed files", list(dest.iterdir()) if dest.exists() else None)
            return 1
        shutil.rmtree(src, ignore_errors=True)
        shutil.rmtree(dest, ignore_errors=True)

        haiku = boss.plan("a haiku")
        split = boss.plan("research X, a plan, and a page")
        if len(haiku) != 1:
            print("haiku should be one step", haiku)
            return 1
        strengths = [step["strength"] for step in split]
        if strengths != ["research", "planning", "coding"]:
            print("foreman split strengths", strengths)
            return 1
        listed = boss.plan(
            "1. research about tatweer\n2. write me a simple html restaurant website\n3. plan me ERDC phase 2"
        )
        listed_bits = [step["prompt"].split("\n\n", 1)[-1] for step in listed]
        if listed_bits != [
            "research about tatweer",
            "write me a simple html restaurant website",
            "plan me ERDC phase 2",
        ]:
            print("numbered split prompts", listed_bits)
            return 1
        if any(step.get("inherit") or step.get("depends_on") is not None for step in listed):
            print("numbered split should be independent", listed)
            return 1
        if [step["strength"] for step in listed] != ["research", "coding", "planning"]:
            print("numbered split strengths", [step["strength"] for step in listed])
            return 1
    finally:
        db.delete_project(other["id"])
        with db._lock:
            con = db.connect()
            con.execute("DELETE FROM memories WHERE project_id=?", (storm["id"],))
            con.execute("DELETE FROM jobs WHERE id IN ('floor-storm', 'floor-other')")
            con.commit()
            con.close()
        shutil.rmtree(repos.cache_dir(storm["id"]), ignore_errors=True)
        db.delete_project(storm["id"])

    try:
        board = lists.get_list_payload("done")
        if not board or board.get("kind") != "done":
            print("done list missing")
            return 1
        try:
            lists.add_item("done", "should fail")
            print("done accepted an item")
            return 1
        except ValueError:
            pass
        try:
            db.create_list({"id": "done", "title": "Nope", "kind": "custom"})
            print("created a list named done")
            return 1
        except ValueError:
            pass
        agent_row = (db.list_agents() or [None])[0]
        if agent_row:
            job = db.create_job(agent_row["id"], "Task: ship the recap")
            db.update_job(job["id"], status="done", output="First line.\nSecond line.\nThird.")
            payload = lists.get_list_payload("done") or {}
            hit = next((row for row in payload.get("items") or [] if row.get("job_id") == job["id"]), None)
            if not hit:
                print("done missing finished job")
                return 1
            if hit.get("text") != "ship the recap":
                print("done title", hit.get("text"))
                return 1
            if "First line" not in (hit.get("recap") or ""):
                print("done recap", hit.get("recap"))
                return 1
            with db._lock:
                con = db.connect()
                con.execute("DELETE FROM artifacts WHERE job_id=?", (job["id"],))
                con.execute("DELETE FROM jobs WHERE id=?", (job["id"],))
                con.commit()
                con.close()
    except Exception as err:
        print("done list check failed", err)
        return 1

    print("quality ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
