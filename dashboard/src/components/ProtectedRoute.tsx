// dashboard/src/components/ProtectedRoute.tsx
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";

interface AuthStatus {
  auth_required: boolean;
  mode: "none" | "password" | "static";
}

type GateState = "loading" | "ok" | "needs-login";

export default function ProtectedRoute() {
  const location = useLocation();
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Step 1: ask the backend whether it requires auth at all.
      let required = true;
      try {
        const status = await api.get<AuthStatus>("/api/auth/status");
        required = status.data.auth_required;
      } catch {
        // Backend down — let the page through; user will see API errors.
        if (!cancelled) setState("ok");
        return;
      }

      if (!required) {
        if (!cancelled) setState("ok");
        return;
      }

      // Step 2: do we have a token?
      const token = getToken();
      if (!token) {
        if (!cancelled) setState("needs-login");
        return;
      }

      // Step 3: validate it.
      try {
        await api.get("/api/auth/me");
        if (!cancelled) setState("ok");
      } catch {
        clearToken();
        if (!cancelled) setState("needs-login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (state === "loading") {
    return (
      <div
        className="login-shell"
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
        }}
      >
        Checking session…
      </div>
    );
  }

  if (state === "needs-login") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
