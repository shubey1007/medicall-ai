// dashboard/src/pages/DoctorDetail.tsx
// Doctor profile page — clicking a doctor card/row on /doctors lands here.
// The primary content is a month calendar of their appointments; sidebar
// shows profile metadata. Edit button routes to /doctors/:id/edit.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Appointment, Doctor, PaginatedResponse, Patient } from "@/types";
import Icon from "@/components/primitives/Icon";
import {
  doctorNameMatches,
  formatDatePretty,
  formatTimePretty,
  initialsFrom,
} from "@/lib/format";
import AppointmentStatusSelect from "@/components/AppointmentStatusSelect";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthGrid(year: number, month: number): Date[] {
  // Builds a 6-row × 7-col grid that surrounds the month. Leading/trailing
  // days belong to adjacent months, which is standard for month calendars.
  const first = new Date(year, month, 1);
  const offset = first.getDay(); // Sun = 0
  const start = new Date(year, month, 1 - offset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }
  return cells;
}

function parseHours(raw: string | undefined | null): [number, number] {
  if (!raw) return [9, 17];
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return [9, 17];
  const sh = parseInt(m[1], 10);
  const eh = parseInt(m[3], 10);
  return [sh, eh];
}

export default function DoctorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [cursor, setCursor] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    // No GET /api/doctors/:id — pull from the list.
    api
      .get<PaginatedResponse<Doctor>>("/api/doctors", { params: { page_size: 100 } })
      .then((r) => {
        const found = r.data.items.find((d) => d.id === id);
        if (!found) {
          setNotFound(true);
          return;
        }
        setDoctor(found);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  useEffect(() => {
    if (!doctor) return;
    // Pull all appointments and filter locally by name. Doctor-doesn't-have-FK
    // on Appointment is an existing schema quirk we work around here.
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const all: Appointment[] = [];
        let page = 1;
        while (page <= 10) {
          const r = await api.get<PaginatedResponse<Appointment>>("/api/appointments", {
            params: { page, page_size: 100 },
          });
          all.push(...r.data.items);
          if (all.length >= r.data.total) break;
          page += 1;
        }
        if (cancelled) return;
        // Loose match: the scheduling agent may have booked under a slightly
        // different name form ("Dr. Smith" vs "Dr. Sarah Smith"). doctorNameMatches
        // collapses case, whitespace, and "Dr." prefixes.
        const mine = all.filter((a) => doctorNameMatches(a.doctor_name, doctor.name));
        setAppointments(mine);

        // Fetch the patient names we'll display
        const uniqueIds = Array.from(new Set(mine.map((a) => a.patient_id)));
        const entries = await Promise.all(
          uniqueIds.map((pid) =>
            api
              .get<Patient>(`/api/patients/${pid}`)
              .then((res) => [pid, res.data] as const)
              .catch(() => [pid, null] as const),
          ),
        );
        if (cancelled) return;
        const map: Record<string, Patient> = {};
        for (const [pid, p] of entries) if (p) map[pid] = p;
        setPatientsById(map);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doctor]);

  const apptsByDayKey = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const d = new Date(a.scheduled_at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(k) ?? [];
      list.push(a);
      map.set(k, list);
    }
    return map;
  }, [appointments]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return appointments
      .filter(
        (a) =>
          a.status !== "cancelled" && new Date(a.scheduled_at).getTime() >= now - 1000 * 60 * 60,
      )
      .sort(
        (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
      )
      .slice(0, 8);
  }, [appointments]);

  if (notFound) {
    return (
      <div className="page">
        <div className="empty" style={{ color: "var(--danger)" }}>
          Doctor not found.
        </div>
      </div>
    );
  }
  if (!doctor) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading doctor…
        </div>
      </div>
    );
  }

  const [sh, eh] = parseHours(doctor.available_hours);
  const capacity = Math.max(0, eh - sh);
  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate("/doctors")}
            style={{ marginBottom: 8 }}
          >
            <Icon name="chevron-left" size={14} /> Back to doctors
          </button>
          <h1 className="page-title">{doctor.name}</h1>
          <div className="page-sub">
            {doctor.specialization} · {doctor.available_hours}
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setDetailsOpen(true)}
          >
            <Icon name="info" size={14} /> View details
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => navigate(`/doctors/${doctor.id}/edit`)}
          >
            <Icon name="edit-3" size={14} /> Edit
          </button>
        </div>
      </div>

      {detailsOpen && (
        <>
          <div className="panel-backdrop" onClick={() => setDetailsOpen(false)} />
          <div className="panel">
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button className="icon-btn" onClick={() => setDetailsOpen(false)} title="Close">
                <Icon name="chevron-left" size={18} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                  Doctor details
                </div>
                <div
                  style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}
                >
                  Read-only view · click Edit to change
                </div>
              </div>
            </div>
            <div
              style={{
                overflowY: "auto",
                padding: 20,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                flex: 1,
              }}
            >
        {/* Profile sidebar — rendered inside the drawer */}
        <div className="panel-card" style={{ padding: 0, border: 0, background: "transparent", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              className="avatar"
              style={{ width: 48, height: 48, fontSize: 16 }}
            >
              {initialsFrom(doctor.name.replace(/^Dr\. /, ""))}
            </div>
            <div>
              <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{doctor.name}</div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  marginTop: 2,
                }}
              >
                ID · {doctor.id.slice(0, 12)}
              </div>
            </div>
          </div>

          <div className="divider" />

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="meta-row">
              <span className="k">Status</span>
              <span className="v">
                {doctor.is_active ? (
                  <span className="badge badge-success">
                    <span className="dot" style={{ background: "var(--success)" }} /> Active
                  </span>
                ) : (
                  <span className="badge badge-neutral">Inactive</span>
                )}
              </span>
            </div>
            <div className="meta-row">
              <span className="k">Phone</span>
              <span className="v">{doctor.phone ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span className="k">Email</span>
              <span className="v" style={{ fontSize: 11 }}>
                {doctor.email ?? "—"}
              </span>
            </div>
            <div className="meta-row">
              <span className="k">Hours</span>
              <span className="v">{doctor.available_hours}</span>
            </div>
            <div className="meta-row">
              <span className="k">Daily capacity</span>
              <span className="v">{capacity} slots</span>
            </div>
          </div>

          <div className="divider" />

          <div>
            <div className="overline" style={{ marginBottom: 8 }}>
              Available days
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {doctor.available_days.length === 0 ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  None set
                </span>
              ) : (
                doctor.available_days.map((day) => (
                  <span key={day} className="badge badge-neutral">
                    {DAY_LABELS[day] ?? day}
                  </span>
                ))
              )}
            </div>
          </div>

          {doctor.bio && (
            <>
              <div className="divider" />
              <div>
                <div className="overline" style={{ marginBottom: 8 }}>
                  Bio
                </div>
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {doctor.bio}
                </div>
              </div>
            </>
          )}

          <div className="divider" />

          <div>
            <div className="overline" style={{ marginBottom: 8 }}>
              Upcoming ({upcoming.length})
            </div>
            {upcoming.length === 0 ? (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                Nothing on the books.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {upcoming.map((a) => {
                  const p = patientsById[a.patient_id];
                  return (
                    <Link
                      key={a.id}
                      to={p ? `/patients/${p.id}` : "#"}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                        {p?.name ?? "Unknown"}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--text-tertiary)" }}
                      >
                        {formatDatePretty(a.scheduled_at)} · {formatTimePretty(a.scheduled_at)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
            </div>
          </div>
        </>
      )}

      {/* Month calendar — now takes the full page width */}
      <div
        className="card"
        style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
      >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{monthLabel}</h3>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                {appointments.filter((a) => a.status !== "cancelled").length} total non-cancelled appointments
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
                }
                title="Previous month"
              >
                <Icon name="chevron-left" size={12} />
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  setCursor(
                    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                  )
                }
              >
                Today
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
                }
                title="Next month"
              >
                <Icon name="chevron-right" size={12} />
              </button>
            </div>
          </div>

          {/* Day-of-week headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
            }}
          >
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "var(--tracking-widest)",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                  textAlign: "center",
                  padding: "4px 0",
                }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
            }}
          >
            {cells.map((d) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
              const dayAppts = (apptsByDayKey.get(key) ?? []).filter(
                (a) => a.status !== "cancelled",
              );
              const dayName = [
                "sunday",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
              ][d.getDay()];
              const works = doctor.available_days.includes(dayName);
              const isToday = sameDay(d, new Date());
              const isSelected = selectedDay && sameDay(selectedDay, d);

              let bg = "var(--bg-surface)";
              let border = "var(--border-subtle)";
              if (!inMonth) {
                bg = "transparent";
              } else if (!works) {
                bg = "var(--bg-elevated)";
              } else if (dayAppts.length === 0) {
                bg = "rgba(52, 211, 153, 0.06)";
                border = "rgba(52, 211, 153, 0.18)";
              } else if (dayAppts.length >= capacity) {
                bg = "rgba(248, 113, 113, 0.10)";
                border = "rgba(248, 113, 113, 0.28)";
              } else {
                bg = "rgba(251, 191, 36, 0.08)";
                border = "rgba(251, 191, 36, 0.22)";
              }

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(d)}
                  disabled={!inMonth}
                  style={{
                    minHeight: 80,
                    padding: 8,
                    border: `1px solid ${border}`,
                    borderRadius: "var(--radius-sm)",
                    background: isSelected ? "var(--brand-subtle)" : bg,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 4,
                    cursor: inMonth ? "pointer" : "default",
                    opacity: inMonth ? 1 : 0.4,
                    boxShadow: isSelected
                      ? "inset 0 0 0 1px var(--brand-400)"
                      : undefined,
                    transition: "background var(--duration-fast)",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 500,
                        color: isToday ? "var(--brand-400)" : "var(--text-primary)",
                      }}
                    >
                      {d.getDate()}
                    </span>
                    {dayAppts.length > 0 && (
                      <span
                        className="badge"
                        style={{
                          height: 18,
                          padding: "0 6px",
                          fontSize: 10,
                          background: "var(--bg-elevated)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        {dayAppts.length}
                      </span>
                    )}
                  </div>
                  {!works && inMonth && (
                    <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Off</span>
                  )}
                  {works && inMonth && dayAppts.length === 0 && (
                    <span
                      style={{ fontSize: 10, color: "var(--success)", fontWeight: 500 }}
                    >
                      Free
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected day drawer */}
          {selectedDay && (
            <div
              style={{
                borderTop: "1px solid var(--border-subtle)",
                paddingTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                    {selectedDay.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    {(() => {
                      const key = `${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}`;
                      const list = (apptsByDayKey.get(key) ?? []).filter(
                        (a) => a.status !== "cancelled",
                      );
                      return `${list.length} appointment${list.length === 1 ? "" : "s"}`;
                    })()}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setSelectedDay(null)}
                >
                  <Icon name="x" size={12} /> Close
                </button>
              </div>

              {(() => {
                const key = `${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}`;
                const list = (apptsByDayKey.get(key) ?? []).sort(
                  (a, b) =>
                    new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
                );
                if (list.length === 0) {
                  return (
                    <div
                      style={{
                        color: "var(--text-tertiary)",
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      No appointments on this day.
                    </div>
                  );
                }
                return list.map((a) => {
                  const p = patientsById[a.patient_id];
                  return (
                    <div
                      key={a.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                          width: 72,
                        }}
                      >
                        {formatTimePretty(a.scheduled_at)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {p ? (
                          <Link
                            to={`/patients/${p.id}`}
                            style={{
                              fontSize: "var(--text-sm)",
                              fontWeight: 500,
                              color: "var(--text-primary)",
                            }}
                          >
                            {p.name ?? "Unknown"}
                          </Link>
                        ) : (
                          <span
                            style={{
                              fontSize: "var(--text-sm)",
                              color: "var(--text-tertiary)",
                            }}
                          >
                            Unknown patient
                          </span>
                        )}
                        {a.notes && (
                          <span
                            style={{
                              fontSize: "var(--text-xs)",
                              color: "var(--text-tertiary)",
                              marginLeft: 8,
                            }}
                          >
                            · {a.notes}
                          </span>
                        )}
                      </div>
                      <AppointmentStatusSelect
                        appointmentId={a.id}
                        status={a.status}
                        onChange={(next) =>
                          setAppointments((prev) =>
                            prev.map((x) => (x.id === a.id ? { ...x, status: next } : x)),
                          )
                        }
                      />
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {loading && appointments.length === 0 && (
            <div
              style={{
                color: "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
                textAlign: "center",
                padding: 12,
              }}
            >
              Loading appointments…
            </div>
          )}
      </div>
    </div>
  );
}
