// dashboard/src/components/Layout/Header.tsx
import { useLocation } from "react-router-dom";
import Icon from "@/components/primitives/Icon";
import { useAppDispatch, useAppSelector } from "@/store";
import { openCmd, toggleTheme } from "@/store/uiSlice";

const CRUMB_MAP: Record<string, [string, string]> = {
  "/": ["Monitor", "Live Dashboard"],
  "/calls": ["Calls", "Call History"],
  "/patients": ["People", "Patients"],
  "/patients/add": ["People", "Add Patient"],
  "/appointments": ["Scheduling", "Appointments"],
  "/schedule": ["Scheduling", "Schedule"],
  "/analytics": ["Insights", "Analytics"],
  "/doctors": ["System", "Doctors"],
  "/doctors/add": ["System", "Add Doctor"],
  "/settings": ["System", "Settings"],
  "/demo": ["System", "Demo"],
  "/docs": ["System", "Docs"],
};

function crumbFor(pathname: string): [string, string] {
  if (CRUMB_MAP[pathname]) return CRUMB_MAP[pathname];
  if (pathname.startsWith("/calls/")) return ["Calls", "Call Detail"];
  if (pathname.startsWith("/patients/")) return ["People", "Patient"];
  if (pathname.match(/^\/doctors\/[^/]+\/edit$/)) return ["System", "Edit Doctor"];
  if (pathname.startsWith("/doctors/")) return ["System", "Doctor"];
  return ["", ""];
}

export default function Header() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const theme = useAppSelector((s) => s.ui.theme);
  const [group, current] = crumbFor(location.pathname);

  return (
    <header className="header">
      <div className="breadcrumb">
        <span className="crumb">{group}</span>
        {group && <span className="sep">/</span>}
        <span className="crumb current">{current}</span>
      </div>

      <button className="header-search" onClick={() => dispatch(openCmd())}>
        <Icon name="search" size={14} />
        <span>Search calls, patients, actions...</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="header-actions">
        <button
          className="icon-btn"
          onClick={() => dispatch(toggleTheme())}
          title="Toggle theme"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
        <button className="icon-btn" title="Notifications">
          <Icon name="bell" size={16} />
        </button>
        <button className="icon-btn" title="Help">
          <Icon name="circle-help" size={16} />
        </button>
      </div>
    </header>
  );
}
