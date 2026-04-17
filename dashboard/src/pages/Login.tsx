// dashboard/src/pages/Login.tsx
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { resetSocket } from "@/lib/socket";

interface LoginResponse {
  token: string;
  expires_in_hours: number;
}

interface AuthStatus {
  auth_required: boolean;
  mode: "none" | "password" | "static";
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<AuthStatus["mode"]>("password");

  // Read where the user came from so we can return them after login.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => {
    // If the backend says auth isn't required, skip login entirely.
    api
      .get<AuthStatus>("/api/auth/status")
      .then((r) => {
        setMode(r.data.mode);
        if (!r.data.auth_required) navigate(from, { replace: true });
      })
      .catch(() => {});
  }, [navigate, from]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", { password });
      setToken(res.data.token);
      resetSocket(); // ensure the next Socket.IO connect uses the new token
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Login failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="text-3xl">🏥</div>
          <h1 className="text-2xl font-bold text-slate-900">MediCall AI</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>

        {mode === "static" ? (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3">
            This server is configured with a static API token, not password login.
            Set <code className="bg-yellow-100 px-1 rounded">DASHBOARD_PASSWORD</code> in
            the backend <code>.env</code> to enable this login form, or paste the
            token into <code>localStorage.medicall_auth_token</code> manually.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs uppercase text-slate-500 font-medium mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !password}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}

        <p className="text-xs text-slate-400 text-center">
          Admin access only · Single-clinic deployment
        </p>
      </div>
    </div>
  );
}
