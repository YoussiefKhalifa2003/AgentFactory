"""Submit the two Foundry eval jobs. API must be running."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:8000"


def req(method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=30) as res:
        return json.loads(res.read().decode())


def wait_job(job_id: str, timeout: int = 180) -> dict:
    start = time.time()
    while time.time() - start < timeout:
        job = req("GET", f"/api/jobs/{job_id}")
        if job["status"] in {"done", "blocked"}:
            return job
        time.sleep(2)
    raise TimeoutError(job_id)


def main() -> int:
    health = req("GET", "/api/health")
    print("health", health)
    coding = req(
        "POST",
        "/api/jobs",
        {
            "agent_id": "ada",
            "prompt": open(
                __file__.replace("run.py", "coding.md"), encoding="utf-8"
            ).read(),
        },
    )
    maths = req(
        "POST",
        "/api/jobs",
        {
            "agent_id": "euclid",
            "prompt": open(
                __file__.replace("run.py", "maths.md"), encoding="utf-8"
            ).read(),
        },
    )
    print("queued", coding["id"], maths["id"])
    c = wait_job(coding["id"])
    m = wait_job(maths["id"])
    print("coding", c["status"], c.get("error"), "artifacts", len(c.get("artifacts") or []))
    print("maths", m["status"], m.get("error"), "artifacts", len(m.get("artifacts") or []))
    ok = c["status"] == "done" and m["status"] == "done"
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as e:
        print("API not reachable:", e)
        sys.exit(2)
