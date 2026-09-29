const LS_API = "factory.api";
const LS_TOKEN = "factory.token";

function envApi() {
  return (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

function envWs() {
  return process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000/ws";
}

export function savedApi(): string {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(LS_API) || "").replace(/\/$/, "");
}

export function savedToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LS_TOKEN) || "";
}

export function saveConnection(api: string, token: string) {
  localStorage.setItem(LS_API, api.replace(/\/$/, ""));
  if (token) localStorage.setItem(LS_TOKEN, token);
  else localStorage.removeItem(LS_TOKEN);
}

export function sameOriginApi(): boolean {
  if (typeof window === "undefined") return false;
  const port = window.location.port;
  return port !== "3001" && port !== "3000";
}

export function apiUrl(): string {
  if (typeof window !== "undefined" && sameOriginApi()) return window.location.origin;
  const saved = savedApi();
  if (saved) return saved;
  return envApi();
}

export function withAuthParam(url: string) {
  const token = savedToken();
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export function wsUrl(): string {
  const token = savedToken();
  const api = apiUrl();
  if (typeof window !== "undefined") {
    try {
      const u = new URL(api);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws";
      u.search = token ? `token=${encodeURIComponent(token)}` : "";
      return u.toString();
    } catch {
      /* fall through */
    }
  }
  const base = envWs();
  if (!token) return base;
  return base.includes("?") ? `${base}&token=${encodeURIComponent(token)}` : `${base}?token=${encodeURIComponent(token)}`;
}

export function authHeaders(): Record<string, string> {
  const token = savedToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const auth = authHeaders();
  for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${apiUrl()}${path}`, { ...init, headers });
}
