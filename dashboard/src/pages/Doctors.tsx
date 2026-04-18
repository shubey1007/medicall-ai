// dashboard/src/pages/Doctors.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Doctor, PaginatedResponse } from "@/types";
import Icon from "@/components/primitives/Icon";
import { initialsFrom } from "@/lib/format";
import { useConfirm } from "@/components/Confirm/ConfirmProvider";

// Routed edit helper — child components reach for it via useNavigate().
// Colocating the path here keeps the two views in sync.
const editPath = (id: string) => `/doctors/${id}/edit`;

type View = "grid" | "list";

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const COLORS = ["#F87171", "#60A5FA", "#34D399", "#A78BFA", "#FBBF24", "#00E5D0"];

function loadView(): View {
  try {
    const v = localStorage.getItem("medicall_doctors_view");
    if (v === "grid" || v === "list") return v;
  } catch {
    // ignore
  }
  return "grid";
}

function statusBadge(isActive: boolean) {
  if (isActive) {
    return (
      <span className="badge badge-success">
        <span className="dot" style={{ background: "var(--success)" }} /> Active
      </span>
    );
  }
  return <span className="badge badge-neutral">Inactive</span>;
}

export default function Doctors() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [view, setView] = useState<View>(loadView);

  useEffect(() => {
    try {
      localStorage.setItem("medicall_doctors_view", view);
    } catch {
      // ignore
    }
  }, [view]);

  function load(q: string) {
    api
      .get<PaginatedResponse<Doctor>>("/api/doctors", { params: { search: q } })
      .then((r) => setDoctors(r.data.items))
      .catch(() => {});
  }

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: "This removes the doctor from your roster and cannot be undone.",
      confirmLabel: "Delete doctor",
      danger: true,
    });
    if (!ok) return;
    setDeleting(id);
    try {
      await api.delete(`/api/doctors/${id}`);
      setDoctors((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Doctors</h1>
          <div className="page-sub">
            {doctors.length} staff · {doctors.filter((d) => d.is_active).length} active
          </div>
        </div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="View mode">
            <button
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
              title="Grid view"
            >
              <Icon name="layout-grid" size={12} /> Grid
            </button>
            <button
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
              title="List view"
            >
              <Icon name="list" size={12} /> List
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => navigate("/doctors/add")}>
            <Icon name="user-plus" size={14} /> Add Doctor
          </button>
        </div>
      </div>

      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Icon
            name="search"
            size={14}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-tertiary)",
            }}
          />
          <input
            className="input"
            placeholder="Search by name or specialization..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 34 }}
          />
        </div>
      </div>

      {doctors.length === 0 ? (
        <div className="empty">
          <Icon name="stethoscope" size={32} style={{ color: "var(--text-tertiary)" }} />
          <div
            style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-primary)" }}
          >
            No doctors yet
          </div>
          <div>Add a doctor so the Scheduling agent can book appointments.</div>
        </div>
      ) : view === "grid" ? (
        <DoctorsGrid doctors={doctors} onDelete={handleDelete} deleting={deleting} />
      ) : (
        <DoctorsList doctors={doctors} onDelete={handleDelete} deleting={deleting} />
      )}
    </div>
  );
}

function DoctorsGrid({
  doctors,
  onDelete,
  deleting,
}: {
  doctors: Doctor[];
  onDelete: (id: string, name: string) => void;
  deleting: string | null;
}) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 12,
      }}
    >
      {doctors.map((d, i) => {
        const color = COLORS[i % COLORS.length];
        return (
          <div
            key={d.id}
            className="card card-hover"
            style={{
              padding: 18,
              animation: "stagger-up 0.3s var(--ease-out) both",
              animationDelay: `${i * 40}ms`,
              cursor: "pointer",
            }}
            onClick={() => navigate(`/doctors/${d.id}`)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div
                className="avatar"
                style={{
                  width: 44,
                  height: 44,
                  fontSize: 14,
                  background: `linear-gradient(135deg, ${color}, ${color}88)`,
                }}
              >
                {initialsFrom(d.name.replace(/^Dr\. /, ""))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--text-md)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.name}
                </div>
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color,
                    fontWeight: 500,
                    letterSpacing: "var(--tracking-wide)",
                    textTransform: "uppercase",
                    marginTop: 2,
                  }}
                >
                  {d.specialization}
                </div>
              </div>
              {statusBadge(d.is_active)}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              {d.phone && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="phone" size={12} />
                  <span className="mono">{d.phone}</span>
                </div>
              )}
              {d.email && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="mail" size={12} />
                  <span>{d.email}</span>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="clock" size={12} />
                {d.available_hours}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Icon name="calendar" size={12} />
                {d.available_days.map((day) => (
                  <span
                    key={day}
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      background: `${color}22`,
                      color,
                      borderRadius: "var(--radius-full)",
                      border: `1px solid ${color}44`,
                    }}
                  >
                    {DAY_LABELS[day] ?? day}
                  </span>
                ))}
              </div>
            </div>
            {d.bio && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                {d.bio.length > 120 ? `${d.bio.slice(0, 120)}…` : d.bio}
              </div>
            )}
            <div
              style={{
                borderTop: "1px solid var(--border-subtle)",
                paddingTop: 10,
                marginTop: 12,
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <button
                className="btn btn-sm btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(editPath(d.id));
                }}
              >
                <Icon name="edit-3" size={12} /> Edit
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(d.id, d.name);
                }}
                disabled={deleting === d.id}
                style={{ color: "var(--danger)" }}
              >
                <Icon name="trash-2" size={12} /> {deleting === d.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DoctorsList({
  doctors,
  onDelete,
  deleting,
}: {
  doctors: Doctor[];
  onDelete: (id: string, name: string) => void;
  deleting: string | null;
}) {
  const navigate = useNavigate();
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 44 }}></th>
            <th>Name</th>
            <th>Specialization</th>
            <th>Contact</th>
            <th>Availability</th>
            <th>Status</th>
            <th style={{ width: 110 }}></th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((d, i) => {
            const color = COLORS[i % COLORS.length];
            return (
              <tr
                key={d.id}
                onClick={() => navigate(`/doctors/${d.id}`)}
                style={{
                  animation: "stagger-up 0.25s var(--ease-out) both",
                  animationDelay: `${i * 18}ms`,
                }}
              >
                <td>
                  <div
                    className="avatar"
                    style={{
                      width: 30,
                      height: 30,
                      fontSize: 11,
                      background: `linear-gradient(135deg, ${color}, ${color}88)`,
                    }}
                  >
                    {initialsFrom(d.name.replace(/^Dr\. /, ""))}
                  </div>
                </td>
                <td style={{ fontWeight: 500 }}>{d.name}</td>
                <td>
                  <span
                    style={{
                      fontSize: 11,
                      color,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "var(--tracking-wide)",
                    }}
                  >
                    {d.specialization}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {d.phone && (
                      <span className="mono" style={{ fontSize: 12 }}>
                        {d.phone}
                      </span>
                    )}
                    {d.email && (
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {d.email}
                      </span>
                    )}
                    {!d.phone && !d.email && (
                      <span style={{ color: "var(--text-tertiary)" }}>—</span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="mono" style={{ fontSize: 11 }}>
                      {d.available_hours}
                    </span>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {d.available_days.map((day) => (
                        <span
                          key={day}
                          style={{
                            fontSize: 9,
                            padding: "1px 5px",
                            background: `${color}22`,
                            color,
                            borderRadius: "var(--radius-full)",
                            border: `1px solid ${color}44`,
                            letterSpacing: "var(--tracking-wide)",
                          }}
                        >
                          {DAY_LABELS[day] ?? day}
                        </span>
                      ))}
                    </div>
                  </div>
                </td>
                <td>{statusBadge(d.is_active)}</td>
                <td>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(editPath(d.id));
                      }}
                      title="Edit doctor"
                    >
                      <Icon name="edit-3" size={12} />
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(d.id, d.name);
                      }}
                      disabled={deleting === d.id}
                      style={{ color: "var(--danger)" }}
                      title="Delete doctor"
                    >
                      <Icon name="trash-2" size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
