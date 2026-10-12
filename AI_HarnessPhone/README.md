# AI Factory phone (PWA)

Assign work from an iPhone. Models, jobs, SQLite, and workspaces stay on the Windows PC. The phone is a second client of the same API and WebSocket hub the desktop Workspace already uses.

This is **not** a TestFlight/Xcode app. Install: Safari → Share → **Add to Home Screen**.

Paper/ink/pigment tokens live in [`packages/ui-tokens/tokens.css`](../packages/ui-tokens/tokens.css) and are imported by both this app and `apps/web`. Change them there.

## Once on the PC and iPhone

1. Install [Tailscale](https://tailscale.com) on the Windows PC and the iPhone. Sign into the same tailnet. Enable MagicDNS.
2. Keep the factory API running on the PC (`127.0.0.1:8000`). Leave Tailscale as a background service. Windows should not sleep while plugged in if you expect to assign from away.
3. Build this app and publish loopback over HTTPS:

```powershell
.\scripts\phone.ps1
```

That runs `npm run build` **in this folder only** (never `apps/web` while `next dev` is up), then prints `tailscale serve --bg 8000`. Restart the API once after the first build so it serves `AI_HarnessPhone/out`.

4. On the iPhone, open `https://<pc-name>.<tailnet>.ts.net` in **Safari** (not Chrome). Share → Add to Home Screen.
5. If `FOUNDRY_TOKEN` is set in `apps/api/.env`, open the in-app gear once and paste it.

The API stays bound to loopback. Tailscale Serve terminates TLS and proxies to `:8000`. Do not expose `8000` on the LAN.

## Dev on the desk

Desktop Workspace stays on port **3000**. This app uses **3001**:

```powershell
cd AI_HarnessPhone
npm install
npm run dev
```

CORS allows `localhost:3001`. To iterate on a real iPhone, serve 3001 over Tailscale temporarily (`tailscale serve --bg 3001`) or type the MagicDNS URL in Settings → Factory URL.

## Tabs

| Tab | What it does |
| --- | --- |
| Lists | Inbox / Done / custom lists. Tap an open row → One / Crew / Split, then `POST /api/assign`. |
| Floor | Agent cards, plant dots, night-shift status (read-only). Tap a card → Desk. |
| Desk | Live thread, View / Save, hold-to-talk, one-off task (`list_id: inbox`), cancel. |

Hold the mic on Desk to speak a job. View and Save work like the PC desk. No 3D office, no Forge, no Agent Brain specimen, no service worker (a stale shell would lie about live jobs). Models stay on the PC.
