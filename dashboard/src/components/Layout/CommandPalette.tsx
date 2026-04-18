import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store";
import { closeCmd, toggleTheme } from "@/store/uiSlice";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";
import type { Patient, PaginatedResponse, Call } from "@/types";
import { maskPhone, formatDuration } from "@/lib/format";

interface CpItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  action: () => void;
}

interface CpGroup {
  name: string;
  items: CpItem[];
}

export default function CommandPalette() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((s) => s.ui.cmdOpen);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setQ("");
    setIdx(0);
    inputRef.current?.focus();
  }, [isOpen]);

  // Fetch patients & recent calls when query changes
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      api
        .get<PaginatedResponse<Patient>>("/api/patients", {
          params: { search: q, page_size: 5 },
        })
        .then((r) => setPatients(r.data.items))
        .catch(() => setPatients([]));
      api
        .get<PaginatedResponse<Call>>("/api/calls", {
          params: { page_size: 5 },
        })
        .then((r) => {
          const lc = q.toLowerCase();
          const list = q
            ? r.data.items.filter(
                (c) =>
                  (c.patient_name ?? "").toLowerCase().includes(lc) ||
                  c.call_sid.toLowerCase().includes(lc),
              )
            : r.data.items;
          setCalls(list.slice(0, 4));
        })
        .catch(() => setCalls([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q, isOpen]);

  const groups: CpGroup[] = useMemo(() => {
    const close = () => dispatch(closeCmd());
    const go = (p: string) => {
      navigate(p);
      close();
    };
    const lc = q.toLowerCase();

    const actions: CpItem[] = [
      { id: "act-call", title: "New outbound call", subtitle: "Go to dashboard", icon: "phone-outgoing", action: () => go("/") },
      { id: "act-add-patient", title: "Add patient", icon: "user-plus", action: () => go("/patients/add") },
      { id: "act-add-doctor", title: "Add doctor", icon: "user-plus", action: () => go("/doctors/add") },
      { id: "act-theme", title: "Toggle theme", subtitle: "⌘+⇧+T", icon: "sun", action: () => { dispatch(toggleTheme()); close(); } },
    ].filter((a) => !q || a.title.toLowerCase().includes(lc));

    const navigation: CpItem[] = [
      { id: "nav-live", title: "Go to Live Dashboard", icon: "activity", action: () => go("/") },
      { id: "nav-hist", title: "Go to Call History", icon: "phone-incoming", action: () => go("/calls") },
      { id: "nav-patients", title: "Go to Patients", icon: "users", action: () => go("/patients") },
      { id: "nav-appts", title: "Go to Appointments", icon: "calendar-clock", action: () => go("/appointments") },
      { id: "nav-analytics", title: "Go to Analytics", icon: "bar-chart-3", action: () => go("/analytics") },
      { id: "nav-doctors", title: "Go to Doctors", icon: "user-round-cog", action: () => go("/doctors") },
      { id: "nav-settings", title: "Go to Settings", icon: "settings", action: () => go("/settings") },
    ].filter((n) => !q || n.title.toLowerCase().includes(lc));

    const callItems: CpItem[] = calls.map((c) => ({
      id: `call-${c.id}`,
      title: c.patient_name ?? "Unknown",
      subtitle: `${formatDuration(c.duration_seconds)} · ${c.call_sid}`,
      icon: "phone-incoming",
      action: () => go(`/calls/${c.id}`),
    }));

    const patientItems: CpItem[] = patients.map((p) => ({
      id: `pat-${p.id}`,
      title: p.name ?? "Unknown",
      subtitle: maskPhone(p.phone),
      icon: "user",
      action: () => go(`/patients/${p.id}`),
    }));

    return [
      { name: "Actions", items: actions },
      { name: "Navigation", items: navigation },
      { name: "Calls", items: callItems },
      { name: "Patients", items: patientItems },
    ].filter((g) => g.items.length > 0);
  }, [q, patients, calls, navigate, dispatch]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeCmd());
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        flat[idx]?.action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, idx, isOpen, dispatch]);

  if (!isOpen) return null;

  let runningIdx = 0;
  return (
    <div className="modal-backdrop" onClick={() => dispatch(closeCmd())}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 20px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <Icon name="search" size={16} style={{ color: "var(--text-tertiary)" }} />
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search calls, patients, actions..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            style={{ padding: 0, border: 0, height: 52, flex: 1 }}
          />
          <span
            style={{
              fontSize: 10,
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            ESC to close
          </span>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto", padding: "8px 0" }}>
          {groups.map((g) => (
            <div key={g.name}>
              <div className="cp-section">{g.name}</div>
              {g.items.map((it) => {
                const myIdx = runningIdx++;
                return (
                  <div
                    key={it.id}
                    className={`cp-result ${myIdx === idx ? "focus" : ""}`}
                    onMouseEnter={() => setIdx(myIdx)}
                    onClick={() => it.action()}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: "var(--bg-elevated)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <Icon name={it.icon} size={13} />
                    </div>
                    <span className="title">{it.title}</span>
                    {it.subtitle && <span className="subtitle">{it.subtitle}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
              }}
            >
              No results for "{q}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
