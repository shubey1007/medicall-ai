// dashboard/src/pages/Login.tsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { resetSocket } from "@/lib/socket";
import { BrandMark, BrandWord } from "@/components/primitives/Brand";
import Icon from "@/components/primitives/Icon";

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

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
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
      resetSocket();
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
    <div className="login-shell">
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 32,
          background: "var(--bg-surface)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <BrandMark size={40} />
          </div>
          <BrandWord />
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              marginTop: 8,
            }}
          >
            Sign in to continue
          </div>
        </div>

        {mode === "static" ? (
          <div
            style={{
              padding: 12,
              background: "var(--warning-subtle)",
              border: "1px solid rgba(251,191,36,0.25)",
              color: "var(--warning)",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-sm)",
              lineHeight: 1.5,
            }}
          >
            This server uses a static API token. Set <code>DASHBOARD_PASSWORD</code> in the backend
            .env to enable this login form, or paste the token into{" "}
            <code>localStorage.medicall_auth_token</code> manually.
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div className="overline" style={{ marginBottom: 6 }}>
                Password
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            {error && (
              <div
                style={{
                  padding: 10,
                  background: "var(--danger-subtle)",
                  border: "1px solid rgba(248,113,113,0.3)",
                  color: "var(--danger)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-sm)",
                }}
              >
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !password}
              style={{ height: 40, marginTop: 4 }}
            >
              {submitting ? (
                <>
                  <Icon name="loader" size={14} /> Signing in…
                </>
              ) : (
                <>
                  <Icon name="log-in" size={14} /> Sign in
                </>
              )}
            </button>
          </form>
        )}

        <div
          style={{
            marginTop: 18,
            textAlign: "center",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          Admin access only · Single-clinic deployment
        </div>
      </div>
    </div>
  );
}
