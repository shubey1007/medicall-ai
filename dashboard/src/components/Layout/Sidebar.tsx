// dashboard/src/components/Layout/Sidebar.tsx
import { NavLink, useNavigate } from "react-router-dom";
import { clearToken } from "@/lib/auth";
import { resetSocket } from "@/lib/socket";

const navItems = [
  { path: "/", label: "Dashboard", icon: "📊" },
  { path: "/calls", label: "Call History", icon: "📞" },
  { path: "/patients", label: "Patients", icon: "👥" },
  { path: "/doctors", label: "Doctors", icon: "🩺" },
  { path: "/analytics", label: "Analytics", icon: "📈" },
  { path: "/settings", label: "Settings", icon: "⚙️" },
  { path: "/demo", label: "Try Demo", icon: "🎙️" },
  { path: "/docs", label: "Docs", icon: "📚" },
];

export default function Sidebar() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    resetSocket();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 p-4 flex flex-col">
      <div className="text-xl font-bold mb-8 px-2">
        🏥 MediCall AI
      </div>
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `px-3 py-2 rounded flex items-center gap-3 ${
                isActive ? "bg-blue-600" : "hover:bg-slate-800"
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-4 px-3 py-2 rounded text-left text-sm text-slate-400 hover:bg-slate-800 hover:text-white flex items-center gap-3"
        title="Sign out"
      >
        <span>🚪</span>
        <span>Logout</span>
      </button>
    </aside>
  );
}
