/** Where the login token lives in the browser. Wrapped in try/catch: storage can be blocked (private mode…). */
const KEY = "tf_token";

/** Fired by the API layer when the server says our token is no longer valid (expired / tampered). */
export const AUTH_EXPIRED_EVENT = "tf:auth-expired";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Only follow same-site, non-auth paths after login (prevents open-redirects like ?next=//evil.com). */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /^\/(login|signup)(\/|$|\?)/.test(raw)) return "/";
  return raw;
}
