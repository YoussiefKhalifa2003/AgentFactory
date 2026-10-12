"""Desk checks that do not need a model: a page, a game, and a plan."""

from __future__ import annotations

import asyncio
import json
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
        if "data-desk-css" not in page or ".hidden" not in page:
            print("view did not inline css")
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

    with tempfile.TemporaryDirectory() as heal_raw:
        fws = Path(heal_raw)
        guitar = (
            "<!DOCTYPE html><html><head>"
            '<link rel="stylesheet" href="theme.css">'
            "</head><body><h1>Guitar</h1>\n"
            "<script>\n"
            'const el = document.querySelector(`.note-dot[data-string="${i}"]);\n'
            "</script>\n"
            '<script src="script.js"></script>\n'
            "</body></html>"
        )
        sandbox.write_file(fws, "index.html", guitar)
        if local._code_balanced('const el = document.querySelector(`.note-dot[data-string="${i}"]);'):
            print("unclosed template counted as balanced")
            return 1
        local.finish_site(fws, "virtual guitar")
        files = set(sandbox.list_files(fws))
        if "theme.css" not in files:
            print("finish_site did not write missing css")
            return 1
        healed = sandbox.read_file(fws, "index.html")
        if '${i}"]`);' not in healed:
            print("finish_site did not close template", healed[healed.find("querySelector"): healed.find("querySelector") + 90] if "querySelector" in healed else healed[:120])
            return 1
        if 'src="script.js"' in healed or "src='script.js'" in healed:
            print("finish_site left a duplicate script.js tag")
            return 1
        miss = fws / "miss"
        miss.mkdir()
        sandbox.write_file(
            miss,
            "index.html",
            '<!DOCTYPE html><html><head></head><body><script src="app.js"></script></body></html>',
        )
        local.finish_site(miss, "a website")
        if "app.js" not in sandbox.list_files(miss):
            print("finish_site did not write missing js")
            return 1
        planted = sandbox.read_file(miss, "app.js")
        if "export" in planted:
            print("classic script got a module stub")
            return 1
        ghost = fws / "ghost"
        ghost.mkdir()
        sandbox.write_file(
            ghost,
            "index.html",
            '<html><head><link rel="stylesheet" href="gone.css"></head>'
            '<body><script src="ghost.js"></script></body></html>',
        )
        page = local.playable_page(
            ghost,
            sandbox.read_file(ghost, "index.html"),
            base="http://127.0.0.1:8000/site/",
        )
        if "ghost.js" in page or "gone.css" in page:
            print("view kept missing assets")
            return 1
        lib = fws / "lib"
        lib.mkdir()
        sandbox.write_file(
            lib,
            "js/main.js",
            "import { bindInput } from './input.js';\nexport function boot(){ bindInput(); }\nboot();\n",
        )
        sandbox.write_file(lib, "index.html", '<html><body><script type="module" src="js/main.js"></script></body></html>')
        local.finish_site(lib, "canvas game")
        if "js/input.js" not in sandbox.list_files(lib):
            print("finish_site did not plant imported js")
            return 1
        extras = fws / "extras"
        extras.mkdir()
        sandbox.write_file(
            extras,
            "index.html",
            '<html><head><link rel="stylesheet" href="styles.css"></head>'
            '<body><script type="module" src="js/main.js"></script></body></html>',
        )
        sandbox.write_file(extras, "styles.css", "body{background:url(hero.png)}")
        sandbox.write_file(extras, "js/main.js", "import { x } from './util.js';\nexport const n=1;\n")
        local.finish_site(extras, "a website")
        planted = set(sandbox.list_files(extras))
        if "hero.png" not in planted:
            print("finish_site did not plant css url", planted)
            return 1
        if "js/util.js" not in planted:
            print("finish_site did not plant sibling import", planted)
            return 1
        util = sandbox.read_file(extras, "js/util.js")
        if "export const x" not in util:
            print("planted import missing named export", util)
            return 1
        bare = fws / "bare"
        bare.mkdir()
        sandbox.write_file(
            bare,
            "index.html",
            '<html><body><script type="module" src="js/main.js"></script></body></html>',
        )
        sandbox.write_file(bare, "js/main.js", "import { bind } from 'helpers.js';\nexport const n=1;\n")
        local.finish_site(bare, "a website")
        if "js/helpers.js" not in sandbox.list_files(bare):
            print("finish_site did not plant import without ./")
            return 1
        shell = fws / "shell"
        shell.mkdir()
        sandbox.write_file(shell, "script.js", JS)
        sandbox.write_file(shell, "styles.css", CSS)
        local.finish_site(shell, "a website")
        if "index.html" not in sandbox.list_files(shell):
            print("finish_site did not plant index.html for js-only desk")
            return 1
        shadow = fws / "shadow"
        shadow.mkdir()
        sandbox.write_file(
            shadow,
            "index.html",
            '<html><body><script src="script.js"></script></body></html>',
        )
        sandbox.write_file(
            shadow,
            "script.js",
            "function drawMinimap(ctx) {\n  const canvas = {};\n  const ctx = canvas;\n  ctx.x = 1;\n}\n",
        )
        if local.js_parses("function drawMinimap(ctx) {\n  const ctx = {};\n}\n"):
            print("js_parses accepted shadowed param")
            return 1
        local.finish_site(shadow, "a website")
        fixed_js = sandbox.read_full(shadow, "script.js")
        if not local.js_parses(fixed_js) or "const ctx" in fixed_js:
            print("finish_site did not repair shadowed param", fixed_js)
            return 1
        huge = fws / "huge"
        huge.mkdir()
        sandbox.write_file(huge, "index.html", PAGE)
        sandbox.write_file(huge, "styles.css", CSS)
        blob = "const n = 1;\n" * 7000
        sandbox.write_bytes(huge, "script.js", blob.encode("utf-8"))
        local.finish_site(huge, "a website")
        kept = sandbox.read_full(huge, "script.js")
        if len(kept) < len(blob):
            print("finish_site truncated a large script", len(kept), len(blob))
            return 1
        if "#loading-screen" not in local.PLAY_JS:
            print("PLAY_JS missing loading overlay hide")
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
    if not harness._use_tools({"strengths": ["writing"]}, "You are the critic. Write critic.md"):
        print("critic writing desk should get tools")
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
    critic_pin = harness._system_prompt(
        {"name": "Ada", "strengths": ["writing"], "instructions": "", "description": ""},
        prompt="You are the critic. Write critic.md",
    )
    if "This is a writing job" in critic_pin:
        print("critic kept writing protocol")
        return 1
    if "critic.md" not in critic_pin.lower():
        print("critic system prompt missing critic.md")
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
    old_brain: dict = {}
    old_brain_projects: list = []
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
        import brain as plant_brain

        old_brain = db.get_brain()
        old_brain_projects = db.list_brain_projects()
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

        parsed = plant_brain.parse_azure_link("https://dev.azure.com/tatweer")
        if parsed.get("organization") != "tatweer" or parsed.get("kind") != "org":
            print("brain parse org failed", parsed)
            return 1
        parsed = plant_brain.parse_azure_link("https://dev.azure.com/tatweer/Stormcast/_git/app")
        if parsed.get("project") != "Stormcast" or parsed.get("repository") != "app":
            print("brain parse repo failed", parsed)
            return 1
        parsed = plant_brain.parse_azure_link(
            "https://tatweer.visualstudio.com/Stormcast/_wiki/wikis/Stormcast.wiki/Home"
        )
        if parsed.get("organization") != "tatweer" or parsed.get("kind") != "wiki":
            print("brain parse wiki failed", parsed)
            return 1
        db.put_brain(wiki_md="Plant clay brief")
        if db.get_brain_public().get("wiki_md") != "Plant clay brief":
            print("brain wiki put missed")
            return 1
        saved_pat = repos._pat
        repos._pat = lambda: ""
        try:
            found = plant_brain.discover("https://dev.azure.com/example")
        finally:
            repos._pat = saved_pat
        if repos.MISSING_PAT not in str(found.get("sync_error") or ""):
            print("discover without PAT missed MISSING_PAT", found)
            return 1
        attached = harness.tools_for_run(allow_sandbox=False, project=None, brain_ready=True) or []
        attached_names = [str((t.get("function") or {}).get("name") or "") for t in attached]
        if "repo_search" not in attached_names or "repo_read" not in attached_names or "recall" not in attached_names:
            print("brain tools missing", attached_names)
            return 1
        if harness.tools_for_run(allow_sandbox=False, project=None, brain_ready=False):
            print("empty job should not attach context tools")
            return 1
        db.replace_brain_projects(
            [{"name": "Stormcast", "included": True, "project_id": storm["id"], "repos": []}]
        )
        db.put_brain(organization="example", wiki_md="Plant clay brief")
        memory.remember_job(
            {"id": "brain-mem", "project_id": "", "prompt": "inbox note"},
            {"id": "hamza", "name": "Hamza"},
            "plant note",
            [],
        )
        if not db.list_memories(db.BRAIN_ID, limit=8):
            print("inbox memory did not land on brain")
            return 1
        hits = repos.search(db.BRAIN_ID, "def storm")
        if "Stormcast" not in hits or "app.py" not in hits:
            print("brain search missed prefix", hits)
            return 1
        plant_brain.study_estate()
        studied = db.get_brain_public()
        if int(studied.get("study_files") or 0) < 1:
            print("brain study missed files", studied)
            return 1
        catalog = plant_brain.digest()
        if "app.py" not in catalog:
            print("brain study digest missed app.py", catalog[:400])
            return 1
        bare = {"id": "hamza", "name": "Hamza", "strengths": ["writing"], "instructions": "", "description": ""}
        brain_prompt = harness._system_prompt(bare, None, "no-list")
        if "Plant clay brief" not in brain_prompt:
            print("brain digest missing from unlinked job", brain_prompt[:400])
            return 1
        if "app.py" not in brain_prompt:
            print("brain study missing from unlinked job", brain_prompt[:400])
            return 1
        if "secret-token-value" in brain_prompt:
            print("token leaked into brain prompt")
            return 1
        import main as api_main

        paths = {getattr(route, "path", "") for route in api_main.app.routes}
        for need in ("/api/brain", "/api/brain/discover", "/api/brain/sync"):
            if need not in paths:
                print("brain route missing", need)
                return 1
    finally:
        try:
            db.put_brain(
                organization=old_brain.get("organization") or "",
                wiki_url=old_brain.get("wiki_url") or "",
                wiki_md=old_brain.get("wiki_md") or "",
                study_md=old_brain.get("study_md") or "",
                studying=0,
                study_files=int(old_brain.get("study_files") or 0),
                study_repos=int(old_brain.get("study_repos") or 0),
                study_projects=int(old_brain.get("study_projects") or 0),
                sync_error=old_brain.get("sync_error"),
                synced_at=old_brain.get("synced_at"),
                poll_enabled=old_brain.get("poll_enabled", True),
            )
            db.replace_brain_projects(old_brain_projects)
        except Exception:
            pass
        db.delete_project(other["id"])
        with db._lock:
            con = db.connect()
            con.execute("DELETE FROM memories WHERE project_id=?", (storm["id"],))
            con.execute("DELETE FROM memories WHERE job_id IN ('x', 'brain-mem')")
            con.execute("DELETE FROM memories WHERE job_id=?", (f"brain-study-{storm['id']}",))
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

    import catalog
    import critic
    import games
    import strengths as skillset
    import coach
    import main as api_main

    if critic.RETRY_MAX < 2:
        print("critic retries too low")
        return 1

    game_prompt = "make a multiplayer canvas game with a score and a level"
    with tempfile.TemporaryDirectory() as raw:
        gws = Path(raw)
        sandbox.write_file(gws, "index.html", PAGE)
        sandbox.write_file(gws, "styles.css", CSS)
        sandbox.write_file(gws, "script.js", JS)
        gap = local.game_gap(gws, game_prompt)
        if not gap or "js/main.js" not in (gap or ""):
            print("game_gap should demand modules", gap)
            return 1
        local.ensure_game_tree(gws, game_prompt)
        if local.game_gap(gws, game_prompt):
            print("ensure_game_tree left a gap", local.game_gap(gws, game_prompt))
            return 1
        sandbox.write_file(gws, "js/main.js", "export function boot(){ requestAnimationFrame(boot); }\n")
        sandbox.write_file(gws, "js/input.js", "export const keys = {};\n")
        sandbox.write_file(gws, "js/entities.js", "export function spawn(){ return {}; }\n")
        sandbox.write_file(gws, "js/net.js", "export function connect(){ return window.FOUNDRY_GAME_WS; }\n")
        sandbox.write_file(gws, "maps/level.json", '{"tiles":[[0]],"spawn":[1,1],"scores":0}\n')
        sandbox.write_file(
            gws,
            "index.html",
            """<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head>
<body><button id="start-btn">Start</button><canvas id="gameCanvas" width="800" height="600"></canvas>
<script type="module" src="js/main.js"></script></body></html>
""",
        )
        sandbox.write_file(gws, "README.md", "Open View, press Start, second browser for multiplayer.")
        local.ensure_game_assets(gws, game_prompt)
        gap = local.game_gap(gws, game_prompt)
        if gap:
            print("complete game tree was rejected", gap)
            return 1
        fps_prompt = "create a FPS shooter game similar to CSGO"
        if not local.wants_fps(fps_prompt):
            print("wants_fps missed CSGO")
            return 1
        if not local.wants_fps("make me an advanced 3D shooter game make sure it works"):
            print("wants_fps missed 3D shooter")
            return 1
        if local.wants_fps("make me an advanced car racing game"):
            print("wants_fps treated racing as FPS")
            return 1
        racer = gws.parent / "racer" if False else Path(raw) / "racer"
        racer.mkdir()
        sandbox.write_file(
            racer,
            "index.html",
            '<html><body><div id="loading-screen">LOADING TRACK...</div>'
            '<script type="module" src="js/main.js"></script></body></html>',
        )
        sandbox.write_file(
            racer,
            "js/main.js",
            "function generateTrack(){ return 1; }\n"
            "function loop(){ requestAnimationFrame(loop); }\n"
            "export function boot(){ generateTrack(); loop(); }\nboot();\n",
        )
        sandbox.write_file(racer, "styles.css", CSS)
        local.finish_site(racer, "make me an advanced car racing game")
        racer_main = sandbox.read_full(racer, "js/main.js")
        if "requestPointerLock" in racer_main or "generateTrack" not in racer_main:
            print("racing finish_site planted fps boot", racer_main[:200])
            return 1
        shooter_ws = Path(raw).parent / f"{Path(raw).name}-3d-shooter"
        shooter_ws.mkdir()
        try:
            sandbox.write_file(
                shooter_ws,
                "index.html",
                "<!DOCTYPE html><html><head><link rel=\"stylesheet\" href=\"styles.css\"></head>"
                "<body><div id=\"start-menu\" class=\"menu\"><button id=\"start-btn\">Start</button></div>"
                "<canvas id=\"game-canvas\" width=\"800\" height=\"600\"></canvas>"
                "<script src=\"js/input.js\"></script>"
                "<script type=\"module\" src=\"js/main.js\"></script></body></html>",
            )
            sandbox.write_file(shooter_ws, "styles.css", local.STUB_CSS)
            sandbox.write_file(
                shooter_ws,
                "js/main.js",
                "document.addEventListener('DOMContentLoaded', () => {\n"
                "  document.getElementById('start-btn').addEventListener('click', () => {\n"
                "    window.FOUNDRY_GAME_WS.startGame();\n"
                "  });\n"
                "});\n",
            )
            sandbox.write_file(
                shooter_ws,
                "js/input.js",
                "const keys = {};\nwindow.addEventListener('keydown', (e) => { keys[e.code] = true; });\n",
            )
            local.finish_site(shooter_ws, "make me an advanced 3D shooter game")
            css = sandbox.read_file(shooter_ws, "styles.css")
            boot = sandbox.read_file(shooter_ws, "js/main.js")
            page = sandbox.read_file(shooter_ws, "index.html")
            if ".overlay" not in css or len(css.strip()) < 160:
                print("3D shooter kept stub css", css[:120])
                return 1
            if "requestPointerLock" not in boot:
                print("3D shooter did not plant fps boot", boot[:160])
                return 1
            if '<script src="js/input.js"' in page:
                print("3D shooter still loads classic js/input.js")
                return 1
            if "overlay" not in page:
                print("3D shooter kept unstyled html")
                return 1
        finally:
            shutil.rmtree(shooter_ws, ignore_errors=True)
        fps_sys = harness._system_prompt(
            {"name": "Rex", "strengths": ["coding"], "instructions": "", "description": ""},
            prompt=fps_prompt,
        )
        if "first-person" not in fps_sys.lower():
            print("system prompt missing FPS bar")
            return 1
        if "smaller substitute" not in fps_sys:
            print("quality close missing")
            return 1
        stub_ws = Path(raw).parent / f"{Path(raw).name}-fps-stub"
        stub_ws.mkdir()
        try:
            sandbox.write_file(stub_ws, "index.html", PAGE)
            sandbox.write_file(stub_ws, "styles.css", CSS)
            sandbox.write_file(stub_ws, "js/main.js", local.STUB_MAIN)
            sandbox.write_file(stub_ws, "js/input.js", local.STUB_INPUT)
            sandbox.write_file(stub_ws, "js/entities.js", local.STUB_ENTITIES)
            sandbox.write_file(stub_ws, "js/net.js", local.STUB_NET)
            sandbox.write_file(stub_ws, "maps/level.json", local.STUB_LEVEL)
            sandbox.write_file(stub_ws, "README.md", "Open View, press Start.")
            stub_gap = local.game_gap(stub_ws, fps_prompt)
            if not stub_gap or "first-person" not in stub_gap.lower():
                print("fps stub was accepted", stub_gap)
                return 1
            ok_stub, _note = harness._verify({"strengths": ["coding"]}, stub_ws, fps_prompt, "ok")
            if ok_stub:
                print("coding verify accepted an FPS stub")
                return 1
            local.ensure_game_tree(stub_ws, fps_prompt)
            planted = sandbox.read_file(stub_ws, "js/main.js")
            if local.looks_like_stub_main(planted):
                print("ensure_game_tree left the FPS stub")
                return 1
            if local.game_gap(stub_ws, fps_prompt):
                print("ensure_game_tree fps still gapped", local.game_gap(stub_ws, fps_prompt))
                return 1
            ok_fixed, _note2 = harness._verify({"strengths": ["coding"]}, stub_ws, fps_prompt, "ok")
            if not ok_fixed:
                print("coding verify rejected salvaged FPS")
                return 1
        finally:
            shutil.rmtree(stub_ws, ignore_errors=True)
        fps_main = (
            "import { bindInput, keys } from './input.js';\n"
            "export function boot() {\n"
            "  bindInput();\n"
            "  const canvas = document.querySelector('canvas');\n"
            "  canvas.requestPointerLock();\n"
            "  let yaw = 0, pitch = 0, ammo = 30;\n"
            "  window.addEventListener('mousemove', (e) => { yaw += e.movementX; pitch += e.movementY; });\n"
            "  window.addEventListener('mousedown', () => { ammo -= 1; });\n"
            "  function loop() {\n"
            "    const dx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);\n"
            "    const dz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);\n"
            "    requestAnimationFrame(loop);\n"
            "  }\n"
            "  loop();\n"
            "}\n"
            "boot();\n"
        )
        sandbox.write_file(gws, "js/main.js", fps_main)
        local.ensure_game_tree(gws, fps_prompt)
        kept = sandbox.read_file(gws, "js/main.js")
        if "requestPointerLock" not in kept or local.looks_like_stub_main(kept):
            print("ensure_game_tree clobbered FPS", kept[:200])
            return 1
        if local.game_gap(gws, fps_prompt):
            print("real FPS still gapped", local.game_gap(gws, fps_prompt))
            return 1
        py_loop = (
            "import { bindInput, keys } from './input.js';\n"
            "export function boot() {\n"
            "  bindInput();\n"
            "  const canvas = document.querySelector('canvas');\n"
            "  canvas.requestPointerLock();\n"
            "  let yaw = 0, pitch = 0, ammo = 30;\n"
            "  window.addEventListener('mousemove', (e) => { yaw += e.movementX; });\n"
            "  window.addEventListener('mousedown', () => { ammo -= 1; });\n"
            "  function loop() {\n"
            "    const dx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);\n"
            "    requestAnimationFrame(loop);\n"
            "  }\n"
            "  loop();\n"
            "}\n"
            "boot();\n"
        )
        mis = Path(raw).parent / f"{Path(raw).name}-misnamed"
        mis.mkdir()
        try:
            sandbox.write_file(mis, "index.html", PAGE)
            sandbox.write_file(mis, "styles.css", CSS)
            sandbox.write_file(mis, "js/input.js", local.STUB_INPUT)
            sandbox.write_file(mis, "js/entities.js", local.STUB_ENTITIES)
            sandbox.write_file(mis, "js/net.js", local.STUB_NET)
            sandbox.write_file(mis, "maps/level.json", local.STUB_LEVEL)
            sandbox.write_file(mis, "README.md", "Open View, press Start.")
            sandbox.write_file(mis, "main.py", py_loop)
            local.ensure_game_tree(mis, fps_prompt)
            promoted = sandbox.read_file(mis, "js/main.js")
            if "requestPointerLock" not in promoted:
                print("main.py was not promoted to js/main.js", promoted[:120])
                return 1
        finally:
            shutil.rmtree(mis, ignore_errors=True)
        import inspect

        stream_default = inspect.signature(catalog.openai_chat_stream).parameters["max_tokens"].default
        if int(stream_default) < 65536:
            print("stream max_tokens too low", stream_default)
            return 1
        if not hasattr(catalog, "context_limited"):
            print("context_limited missing")
            return 1
        if "131072" not in inspect.getsource(catalog.chat):
            print("spark token ladder missing")
            return 1
        catalog.clear_abort("abort-test")
        catalog._aborted.add("abort-test")
        catalog._local_backend["abort-test"] = "qwen3:14b"
        if not catalog.job_aborted("abort-test"):
            print("job_aborted missed a stopped job")
            return 1
        catalog.clear_abort("abort-test")
        if catalog.job_aborted("abort-test"):
            print("clear_abort left a flag")
            return 1
        if not hasattr(catalog, "abort_in_flight"):
            print("abort_in_flight missing")
            return 1
        with tempfile.TemporaryDirectory() as dump_raw:
            dws = Path(dump_raw)
            dump = (
                "index.html\n<!DOCTYPE html><html><head><link rel=\"stylesheet\" href=\"styles.css\"></head>\n"
                "<body><div id=\"menu\" class=\"menu-hidden\"><button id=\"start-btn\">Start</button></div>\n"
                "<canvas id=\"game-canvas\" width=\"800\" height=\"600\"></canvas>\n"
                "<script type=\"module\" src=\"js/main.js\"></script></body></html>\n\n"
                "styles.css\nbody { margin:0; background:#111 } .hidden{display:none}\n\n"
                "js/main.js\nexport function boot(){ requestAnimationFrame(boot); }\n"
            )
            sandbox.write_file(dws, "index.html", dump)
            html_dump = sandbox.read_file(dws, "index.html")
            css_dump = sandbox.read_file(dws, "styles.css")
            if "styles.css\nbody" in html_dump or "<!DOCTYPE" in css_dump:
                print("labeled dump was not split", html_dump[:80], css_dump[:80])
                return 1
            if "menu-hidden" in html_dump:
                print("start stayed hidden", html_dump)
                return 1
        fences = local.extract_fences(
            "```js/net.js\nexport const n=1;\n```\n```js/main.js\nexport function boot(){}\n```\n```json\n{\"tiles\":[]}\n```"
        )
        names = {rel for rel, _body in fences}
        if "js/net.js" not in names or "js/main.js" not in names:
            print("fences dropped game modules", names)
            return 1
        local.materialize_site(gws, "")
        html = sandbox.read_file(gws, "index.html")
        if "js/main.js" not in html:
            print("modules flattened")
            return 1
        if local.site_gap(gws):
            print("complete game tree failed site_gap", local.site_gap(gws))
            return 1
        maps = local.extract_fences("```maps/level.json\n{\"tiles\":[[0]]}\n```")
        if "maps/level.json" not in {rel for rel, _body in maps}:
            print("fences dropped maps/level.json")
            return 1
        page = local.playable_page(gws, html, base="http://127.0.0.1:8000/site/", job_id="job-1")
        if "FOUNDRY_GAME_WS" not in page:
            print("view missing game ws shim")
            return 1
        if ".mjs" not in api_main.SITE_MIME or ".json" not in api_main.SITE_MIME:
            print("SITE_MIME missing module types")
            return 1
        if ".svg" not in api_main.SITE_MIME or ".woff2" not in api_main.SITE_MIME:
            print("SITE_MIME missing font or svg")
            return 1
        site_src = inspect.getsource(api_main.job_site)
        if "finish_site" not in site_src or "/* missing */" not in site_src:
            print("job_site does not heal missing files")
            return 1
        if "finish_site" not in inspect.getsource(harness._finish):
            print("_finish does not heal the desk")
            return 1
        if games.message_ok("x" * (games.GAME_MSG_CAP + 1)):
            print("relay accepted an oversized message")
            return 1
        if not games.message_ok("ok"):
            print("relay rejected a small message")
            return 1
        try:
            sandbox.write_file(gws, "../.env", "nope")
            print("path refuse failed")
            return 1
        except ValueError:
            pass
        png = local.placeholder_png()
        sandbox.write_bytes(gws, "eyes/shot.png", png)
        msg, looked = harness._opening_user(
            gws, "look at the UI", {"strengths": ["coding"], "name": "Ada"}, "local:qwen3-vl:8b"
        )
        packed_open = json.dumps(msg)
        if "Auto look_at" not in packed_open or not msg.get("images"):
            print("first-turn look_at missing", packed_open[:180])
            return 1
        if "eyes/shot.png" not in str(looked):
            print("opening look skipped desk image")
            return 1
        spark_open, _looked = harness._opening_user(
            gws, "look at the UI", {"strengths": ["coding"], "name": "Ada"}, "spark:qwen3.6:35b-a3b"
        )
        spark_packed = json.dumps(spark_open)
        if spark_open.get("images") or "data:image" in spark_packed:
            print("spark text desk received images")
            return 1
        msg = catalog.user_with_images("look", gws, ["eyes/shot.png"])
        if not msg.get("images") or not isinstance(msg.get("content"), list):
            print("user_with_images missing images", msg.keys())
            return 1
        ollama = catalog._ollama_messages([msg])
        if not ollama[0].get("images"):
            print("ollama payload missing images")
            return 1
        openai = catalog._openai_messages([msg])
        if "images" in openai[0]:
            print("openai payload kept ollama images key")
            return 1
        blob = json.dumps(openai)
        if len(blob) > 8_000_000:
            print("openai payload too large")
            return 1
        stripped = catalog.text_only_messages([msg])
        if catalog.messages_have_images(stripped) or "data:image" in json.dumps(stripped):
            print("text_only_messages left images")
            return 1
        text_only = catalog.user_with_images("look", gws, [])
        packed = json.dumps(text_only)
        if "data:image" in packed:
            print("text-only path included a data URL")
            return 1
        if not hasattr(harness, "_desk_gap"):
            print("desk gap helper missing")
            return 1
        import base64
        import io

        import eyes as vision
        from PIL import Image

        wide = Image.new("RGB", (2000, 800), (12, 24, 48))
        buf = io.BytesIO()
        wide.save(buf, format="PNG")
        sandbox.write_bytes(gws, "eyes/wide.png", buf.getvalue())
        encoded = vision.encode_image(sandbox.resolve(gws, "eyes/wide.png"))
        if not encoded:
            print("encode_image dropped a resizable png")
            return 1
        out = Image.open(io.BytesIO(base64.b64decode(encoded[0])))
        if max(out.size) > 1280:
            print("long edge not resized", out.size)
            return 1
        shot = vision.qa_start(gws)
        if shot.get("ok") and "eyes/qa.png" not in sandbox.list_files(gws):
            print("click_view did not write eyes/qa.png")
            return 1
        if not hasattr(vision, "click_view"):
            print("click_view helper missing")
            return 1

    agents = db.list_agents()
    if len(agents) >= 2:
        producer = next((a for a in agents if "coding" in (a.get("strengths") or [])), agents[0])
        steps = critic.inject_steps(
            [{"agent_id": producer["id"], "strength": "coding", "prompt": "", "inherit": False}],
            "write a game",
        )
        if len(steps) < 2:
            print("critic was not injected")
            return 1
        if steps[0]["agent_id"] == steps[1]["agent_id"]:
            print("critic used the producer desk")
            return 1
        reused = critic.inject_steps(
            [
                {"agent_id": producer["id"], "strength": "coding", "inherit": False},
                {
                    "agent_id": steps[1]["agent_id"],
                    "strength": "review",
                    "prompt": "review the files",
                    "inherit": True,
                },
            ],
            "write a game",
        )
        if len(reused) != 2:
            print("double critic injected", len(reused))
            return 1
        solo = critic.inject_steps(
            [{"agent_id": producer["id"], "strength": "coding", "inherit": False}],
            "code",
        )
        # With multiple agents this still injects; skip-if-solo is pick_critic empty.
        assert critic.already_has_critic(reused)
        other = critic.pick_critic(producer["id"], "coding")
        if other and other["id"] == producer["id"]:
            print("critic picked the producer")
            return 1
        if critic.critic_has_high("## Verdict\nFail.\nseverity: high\n") is False:
            print("high finding not detected")
            return 1
        fps_eyes = critic.inject_steps(
            [{"agent_id": producer["id"], "strength": "coding", "prompt": "", "inherit": False}],
            "create a FPS shooter game similar to CSGO",
        )
        if len(fps_eyes) < 2 or "You are the critic" not in (fps_eyes[1].get("prompt") or ""):
            print("fps critic was not injected")
            return 1
        if "first-person" not in (fps_eyes[1].get("prompt") or "").lower() and "FPS" not in (
            fps_eyes[1].get("prompt") or ""
        ):
            print("critic not told about FPS", fps_eyes[1].get("prompt"))
            return 1

    with tempfile.TemporaryDirectory() as critic_raw:
        cws = Path(critic_raw)
        ok, note = harness._verify({"strengths": ["qa"]}, cws, critic.CRITIC_PROMPT, "ok")
        if not ok:
            print("critic should salvage a Verdict", note)
            return 1
        saved = sandbox.read_file(cws, "critic.md")
        if "verdict" not in saved.lower():
            print("critic.md missing Verdict after salvage")
            return 1
        full = cws / "full"
        full.mkdir()
        sandbox.write_file(full, "index.html", PAGE)
        if harness._desk_gap(full, critic.CRITIC_PROMPT):
            print("critic asked to finish the game")
            return 1
        harness._ensure_critic_markdown(
            full, "I cannot open inherited files or interact with a live environment."
        )
        saved = sandbox.read_file(full, "critic.md")
        if "verdict" not in saved.lower() or critic.critic_has_high(saved):
            print("refusal on a full desk should ship", saved[:180])
            return 1
        sandbox.write_file(cws, "critic.md", "## Verdict\nShip.\n## Findings\n1. **low** — nits.\n")
        ok, note = harness._verify({"strengths": ["qa"]}, cws, critic.CRITIC_PROMPT, "ok")
        if not ok:
            print("critic should pass on verdict", note)
            return 1
        chat_ws = cws / "chat"
        chat_ws.mkdir()
        harness._ensure_critic_markdown(
            chat_ws, "**Verdict:** Ship\n## Findings\n1. **low** — none.\n"
        )
        if "verdict" not in sandbox.read_file(chat_ws, "critic.md").lower():
            print("bold Verdict was not salvaged")
            return 1

    overlay_agent = (db.list_agents() or [{"id": "ada"}])[0]["id"]
    overlay_dir = db.DATA / "skills" / overlay_agent
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "coding.md").write_text("- games must write js/net.js\n", encoding="utf-8")
    packed = skillset.pack_body("coding", overlay_agent)
    if "js/net.js" not in packed:
        print("overlay not concatenated")
        return 1
    git_skill = (ROOT / "skills" / "coding" / "SKILL.md").read_text(encoding="utf-8")
    if "Desk notes" in git_skill:
        print("git skill was rewritten")
        return 1
    if not coach.SECRET.search("put AZURE_DEVOPS_PAT in the overlay"):
        print("overlay secret refuse missing")
        return 1
    db.clear_route_stats(overlay_agent)
    for _ in range(3):
        db.bump_route_stat("coding", overlay_agent, "spark:qwen3.8", "done", 10)
    db.bump_route_stat("coding", overlay_agent, "local:qwen3:14b", "blocked", 4)
    prefer = coach.preferred_model(overlay_agent, "coding")
    if prefer != "spark:qwen3.8":
        print("route_stats did not prefer the winner", prefer)
        return 1
    catalog._spark_models = set()
    vis = catalog.pick_vision_model({"model": "spark:qwen3.6:35b-a3b"})
    if vis:
        print("empty spark list picked vision", vis)
        return 1
    if catalog.model_accepts_images("spark:qwen3-vl:8b"):
        print("unloaded spark VL accepted images")
        return 1
    catalog._spark_models = {"qwen3.6:35b-a3b"}
    vis = catalog.pick_vision_model({"model": "spark:qwen3.6:35b-a3b"})
    if vis:
        print("text spark desk picked vision", vis)
        return 1
    db.bump_route_stat("coding", overlay_agent, "broken", "blocked", 4)
    # infra skip happens in coach.record, not bump
    if not coach.is_infra("OPENROUTER 401"):
        print("infra detector missed 401")
        return 1
    if not hasattr(__import__("eyes"), "click_view"):
        print("click_view helper missing")
        return 1
    if not hasattr(__import__("eyes"), "qa_start"):
        print("qa_start helper missing")
        return 1

    print("quality ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
