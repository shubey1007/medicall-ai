// dashboard/src/components/Layout/Sidebar.tsx
import { NavLink } from "react-router-dom";

const navItems = [
  { path: "/", label: "Dashboard", icon: "📊" },
  { path: "/calls", label: "Call History", icon: "📞" },
  { path: "/patients", label: "Patients", icon: "👥" },
  { path: "/doctors", label: "Doctors", icon: "🩺" },
  { path: "/analytics", label: "Analytics", icon: "📈" },
  { path: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-slate-900 text-slate-100 p-4 flex flex-col">
      <div className="text-xl font-bold mb-8 px-2">
        🏥 MediCall AI
      </div>
      <nav className="flex flex-col gap-1">
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
    </aside>
  );
}
