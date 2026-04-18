// dashboard/src/components/Layout/Sidebar.tsx
import { NavLink, useNavigate } from "react-router-dom";
import { useAppSelector } from "@/store";
import { clearToken } from "@/lib/auth";
import { resetSocket } from "@/lib/socket";
import Icon from "@/components/primitives/Icon";
import { BrandMark, BrandWord } from "@/components/primitives/Brand";

const MONITOR_ITEMS = [
  { path: "/", label: "Live Dashboard", icon: "activity", end: true },
  { path: "/calls", label: "Call History", icon: "phone-incoming" },
  { path: "/patients", label: "Patients", icon: "users" },
  { path: "/appointments", label: "Appointments", icon: "calendar-clock" },
  { path: "/schedule", label: "Schedule", icon: "calendar-days" },
  { path: "/analytics", label: "Analytics", icon: "bar-chart-3" },
];

const SYSTEM_ITEMS = [
  { path: "/doctors", label: "Doctors", icon: "user-round-cog" },
  { path: "/demo", label: "Try Demo", icon: "mic" },
  { path: "/docs", label: "Docs", icon: "book-open" },
  { path: "/settings", label: "Settings", icon: "settings" },
];

function NavRow({
  path,
  label,
  icon,
  end,
  count,
}: {
  path: string;
  label: string;
  icon: string;
  end?: boolean;
  count?: number;
}) {
  return (
    <NavLink
      to={path}
      end={end}
      className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
    >
      <Icon name={icon} size={17} strokeWidth={2} />
      <span>{label}</span>
      {typeof count === "number" && count > 0 && <span className="count">{count}</span>}
    </NavLink>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const activeCount = useAppSelector((s) => Object.keys(s.calls.activeCalls).length);

  function logout() {
    clearToken();
    resetSocket();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandMark />
        <BrandWord />
      </div>

      <div className="nav">
        <div className="nav-section">Monitor</div>
        {MONITOR_ITEMS.map((n) => (
          <NavRow
            key={n.path}
            path={n.path}
            label={n.label}
            icon={n.icon}
            end={n.end}
            count={n.path === "/" ? activeCount : undefined}
          />
        ))}

        <div className="nav-section" style={{ marginTop: 12 }}>
          System
        </div>
        {SYSTEM_ITEMS.map((n) => (
          <NavRow key={n.path} path={n.path} label={n.label} icon={n.icon} />
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sys-status">
          <span className="dot" />
          <span>All systems online</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>
            v2.4
          </span>
        </div>
        <button className="user-chip" onClick={logout} title="Sign out">
          <div className="avatar">DR</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <span className="name">Dr. Admin</span>
            <span className="role">Clinic Admin</span>
          </div>
          <Icon
            name="log-out"
            size={14}
            style={{ marginLeft: "auto", color: "var(--text-tertiary)" }}
          />
        </button>
      </div>
    </aside>
  );
}
