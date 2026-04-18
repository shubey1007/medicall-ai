// dashboard/src/pages/Patients.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { PaginatedResponse, Patient } from "@/types";
import Icon from "@/components/primitives/Icon";
import { formatDatePretty, initialsFrom, maskPhone } from "@/lib/format";

type View = "grid" | "list";

function loadView(): View {
  try {
    const v = localStorage.getItem("medicall_patients_view");
    if (v === "grid" || v === "list") return v;
  } catch {
    // ignore
  }
  return "grid";
}

export default function Patients() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>(loadView);

  useEffect(() => {
    try {
      localStorage.setItem("medicall_patients_view", view);
    } catch {
      // ignore
    }
  }, [view]);

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .get<PaginatedResponse<Patient>>("/api/patients", { params: { search, page_size: 60 } })
        .then((r) => {
          setPatients(r.data.items);
          setTotal(r.data.total);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Patients</h1>
          <div className="page-sub">
            {total > 0 ? `${total} patients in system` : `${patients.length} patients`}
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
          <button className="btn btn-primary" onClick={() => navigate("/patients/add")}>
            <Icon name="user-plus" size={14} /> Add Patient
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
            placeholder="Search patients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 34 }}
          />
        </div>
      </div>

      {patients.length === 0 ? (
        <div className="empty">
          <Icon name="users" size={32} style={{ color: "var(--text-tertiary)" }} />
          <div
            style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-primary)" }}
          >
            No patients found
          </div>
          <div>Try a different search or add a new patient.</div>
        </div>
      ) : view === "grid" ? (
        <PatientsGrid patients={patients} onOpen={(p) => navigate(`/patients/${p.id}`)} />
      ) : (
        <PatientsList patients={patients} onOpen={(p) => navigate(`/patients/${p.id}`)} />
      )}
    </div>
  );
}

function patientStats(p: Patient) {
  const ctx = p.medical_context as {
    allergies?: string[];
    conditions?: string[];
    medications?: string[];
  };
  return {
    ctx,
    allergies: ctx?.allergies?.length ?? 0,
    conditions: ctx?.conditions?.length ?? 0,
    medications: ctx?.medications?.length ?? 0,
  };
}

/** Schema-agnostic record counter. Sums array lengths and counts any other
 * non-empty value as 1. Works for whatever shape medical_context evolves into. */
function recordCount(ctx: Record<string, unknown> | null | undefined): number {
  if (!ctx) return 0;
  let total = 0;
  for (const v of Object.values(ctx)) {
    if (Array.isArray(v)) total += v.length;
    else if (v !== null && v !== undefined && v !== "") total += 1;
  }
  return total;
}

function PatientsGrid({
  patients,
  onOpen,
}: {
  patients: Patient[];
  onOpen: (p: Patient) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 12,
      }}
    >
      {patients.map((p, i) => {
        const s = patientStats(p);
        return (
          <div
            key={p.id}
            className="card card-hover"
            style={{
              padding: 16,
              cursor: "pointer",
              animation: `stagger-up 0.3s var(--ease-out) both`,
              animationDelay: `${i * 30}ms`,
            }}
            onClick={() => onOpen(p)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div className="avatar" style={{ width: 40, height: 40, fontSize: 14 }}>
                {initialsFrom(p.name, "??")}
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
                  {p.name ?? "Unknown"}
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  {maskPhone(p.phone)}
                </div>
              </div>
              {s.conditions > 0 && <span className="badge badge-warning">{s.conditions} cond</span>}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                borderTop: "1px solid var(--border-subtle)",
                paddingTop: 10,
              }}
            >
              <span>
                {s.allergies > 0 && "⚠ "}
                {s.allergies + s.conditions + s.medications} records
              </span>
              <span>
                Since{" "}
                {new Date(p.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PatientsList({
  patients,
  onOpen,
}: {
  patients: Patient[];
  onOpen: (p: Patient) => void;
}) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 44 }}></th>
            <th>Name</th>
            <th>Phone</th>
            <th>Records</th>
            <th>Patient since</th>
            <th>Last updated</th>
            <th>ID</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p, i) => {
            const records = recordCount(p.medical_context);
            return (
              <tr
                key={p.id}
                onClick={() => onOpen(p)}
                style={{
                  animation: "stagger-up 0.25s var(--ease-out) both",
                  animationDelay: `${i * 18}ms`,
                }}
              >
                <td>
                  <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>
                    {initialsFrom(p.name, "??")}
                  </div>
                </td>
                <td style={{ fontWeight: 500 }}>{p.name ?? "Unknown"}</td>
                <td className="mono" style={{ color: "var(--text-secondary)" }}>
                  {maskPhone(p.phone)}
                </td>
                <td>
                  {records === 0 ? (
                    <span style={{ color: "var(--text-tertiary)" }}>—</span>
                  ) : (
                    <span className="badge badge-neutral">{records}</span>
                  )}
                </td>
                <td className="mono" style={{ color: "var(--text-secondary)" }}>
                  {formatDatePretty(p.created_at)}
                </td>
                <td className="mono" style={{ color: "var(--text-secondary)" }}>
                  {formatDatePretty(p.updated_at)}
                </td>
                <td
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-tertiary)" }}
                >
                  {p.id.slice(0, 8)}
                </td>
                <td>
                  <Icon
                    name="chevron-right"
                    size={14}
                    style={{ color: "var(--text-tertiary)" }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
