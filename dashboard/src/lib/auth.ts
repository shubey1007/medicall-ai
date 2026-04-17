// dashboard/src/lib/auth.ts
// Tiny auth helpers — token lives in localStorage. The token itself is a JWT
// issued by POST /api/auth/login.

const TOKEN_KEY = "medicall_auth_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage disabled — caller should treat as unauthenticated
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
