// dashboard/src/pages/Schedule.tsx
// Planning workspace for the scheduling flow. Distinct from /appointments
// (which is a transactional log of what's on the books). This page asks
// "when is X free?" and "who is Y seeing?" with filters across doctors,
// patients and date range, plus a calendar matrix of free-vs-booked.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type {
  Appointment,
  Doctor,
  PaginatedResponse,
  Patient,
} from "@/types";
import Icon from "@/components/primitives/Icon";
import {
  doctorKey,
  doctorNameMatches,
  formatDatePretty,
  formatTimePretty,
  initialsFrom,
} from "@/lib/format";
import { dashboardSocket } from "@/lib/socket";
import AppointmentStatusSelect from "@/components/AppointmentStatusSelect";

type RangePreset = "week" | "2weeks" | "month" | "custom";
type ViewMode = "calendar" | "list";

const WEEKDAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const JS_DAY_TO_NAME: Record<number, (typeof WEEKDAY_ORDER)[number]> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

// Status badges are rendered via AppointmentStatusSelect everywhere in this
// page, which owns its own color map. No local constant needed.

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cur = startOfDay(from);
  const end = startOfDay(to);
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "09:00-17:00" → [9, 17]. Falls back to 9→17 on unparseable input. */
function parseHours(raw: string | undefined | null): [number, number] {
  if (!raw) return [9, 17];
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return [9, 17];
  const sh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const eh = Math.max(sh + 1, Math.min(24, parseInt(m[3], 10)));
  return [sh, eh];
}

function slotsForDay(d: Date, startHour: number, endHour: number): Date[] {
  const out: Date[] = [];
  for (let h = startHour; h < endHour; h++) {
    out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0));
  }
  return out;
}

function doctorWorksOn(d: Date, days: string[] | null | undefined): boolean {
  if (!days || days.length === 0) return false;
  const key = JS_DAY_TO_NAME[d.getDay()];
  return days.includes(key);
}

function rangeFor(preset: RangePreset, from: string, to: string): { from: Date; to: Date } {
  const today = startOfDay(new Date());
  if (preset === "week") return { from: today, to: addDays(today, 6) };
  if (preset === "2weeks") return { from: today, to: addDays(today, 13) };
  if (preset === "month") return { from: today, to: addDays(today, 29) };
  // custom
  const f = from ? new Date(from) : today;
  const t = to ? new Date(to) : addDays(f, 6);
  return { from: startOfDay(f), to: startOfDay(t) };
}

// ─── Component ────────────────────────────────────────────────────────────

export default function Schedule() {
  const navigate = useNavigate();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);

  const [doctorIds, setDoctorIds] = useState<Set<string>>(new Set());
  const [patientId, setPatientId] = useState<string>("");
  const [statuses, setStatuses] = useState<Set<string>>(new Set(["confirmed", "pending"]));
  const [preset, setPreset] = useState<RangePreset>("week");
  const [customFrom, setCustomFrom] = useState<string>(isoDate(new Date()));
  const [customTo, setCustomTo] = useState<string>(isoDate(addDays(new Date(), 6)));
  const [view, setView] = useState<ViewMode>("calendar");
  const [focus, setFocus] = useState<{ doctorId: string; day: Date } | null>(null);

  // Load doctors + patients once
  useEffect(() => {
    api
      .get<PaginatedResponse<Doctor>>("/api/doctors", { params: { page_size: 100 } })
      .then((r) => setDoctors(r.data.items))
      .catch(() => {});
    api
      .get<PaginatedResponse<Patient>>("/api/patients", { params: { page_size: 200 } })
      .then((r) => setPatients(r.data.items))
      .catch(() => {});
  }, []);

  // Fetch all appointments and filter in memory — page size cap is 100 so we
  // page through up to a reasonable limit. For larger clinics we'd add a date
  // filter to the endpoint, but for now this keeps the UI snappy.
  async function loadAppointments() {
    setLoadingAppointments(true);
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
      setAppointments(all);
    } catch {
      // leave appointments as-is
    } finally {
      setLoadingAppointments(false);
    }
  }

  useEffect(() => {
    void loadAppointments();
  }, []);

  // Live-refresh when an agent books during a call.
  const loadRef = useRef(loadAppointments);
  loadRef.current = loadAppointments;
  useEffect(() => {
    const handler = () => void loadRef.current();
    dashboardSocket.on("appointment:created", handler);
    return () => {
      dashboardSocket.off("appointment:created", handler);
    };
  }, []);

  const { from: rangeFrom, to: rangeTo } = useMemo(
    () => rangeFor(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );
  const days = useMemo(() => daysBetween(rangeFrom, rangeTo), [rangeFrom, rangeTo]);

  const selectedDoctors = useMemo(() => {
    if (doctorIds.size === 0) return doctors.filter((d) => d.is_active);
    return doctors.filter((d) => doctorIds.has(d.id));
  }, [doctors, doctorIds]);

  // Apply filters: doctor (by loose name match, since Appointment.doctor_name
  // is a string and not an FK), patient, date, status.
  const filteredAppointments = useMemo(() => {
    const selectedKeys = new Set(selectedDoctors.map((d) => doctorKey(d.name)));
    return appointments.filter((a) => {
      if (doctorIds.size > 0 && !selectedKeys.has(doctorKey(a.doctor_name))) return false;
      if (patientId && a.patient_id !== patientId) return false;
      if (statuses.size > 0 && !statuses.has(a.status)) return false;
      const d = new Date(a.scheduled_at);
      if (d < rangeFrom || d > addDays(rangeTo, 1)) return false;
      return true;
    });
  }, [appointments, selectedDoctors, doctorIds, patientId, statuses, rangeFrom, rangeTo]);

  // Per-doctor, per-day index. Key by the roster doctor's canonical name so
  // appointments booked under slightly different spellings still hit the cell.
  const apptIndex = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of filteredAppointments) {
      const d = new Date(a.scheduled_at);
      // Find the canonical roster name this appointment corresponds to.
      const match = doctors.find((doc) => doctorNameMatches(a.doctor_name, doc.name));
      const canonicalName = match ? match.name : a.doctor_name;
      const k = `${canonicalName}|${isoDate(d)}`;
      const list = map.get(k) ?? [];
      list.push(a);
      map.set(k, list);
    }
    return map;
  }, [filteredAppointments, doctors]);

  const patientsById = useMemo(() => {
    const m: Record<string, Patient> = {};
    for (const p of patients) m[p.id] = p;
    return m;
  }, [patients]);

  // KPIs
  const kpis = useMemo(() => {
    const apptCount = filteredAppointments.filter((a) => a.status !== "cancelled").length;
    const activeDoctors = selectedDoctors.filter((d) => d.is_active).length;

    let totalSlots = 0;
    let bookedSlots = 0;
    for (const doc of selectedDoctors) {
      const [sh, eh] = parseHours(doc.available_hours);
      const dailySlots = Math.max(0, eh - sh);
      for (const day of days) {
        if (!doctorWorksOn(day, doc.available_days)) continue;
        totalSlots += dailySlots;
        const key = `${doc.name}|${isoDate(day)}`;
        const dayAppts = (apptIndex.get(key) ?? []).filter((a) => a.status !== "cancelled");
        bookedSlots += Math.min(dailySlots, dayAppts.length);
      }
    }
    const freeSlots = Math.max(0, totalSlots - bookedSlots);
    return { apptCount, activeDoctors, totalSlots, freeSlots, bookedSlots };
  }, [filteredAppointments, selectedDoctors, days, apptIndex]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Schedule</h1>
          <div className="page-sub">
            Plan availability across your team · {days.length} days in view
          </div>
        </div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="View mode">
            <button
              className={view === "calendar" ? "active" : ""}
              onClick={() => setView("calendar")}
            >
              <Icon name="calendar-days" size={12} /> Calendar
            </button>
            <button
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              <Icon name="list" size={12} /> List
            </button>
          </div>
          <button className="btn btn-secondary" onClick={() => void loadAppointments()}>
            <Icon name="refresh-cw" size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="card"
        style={{ padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          <DoctorMultiSelect
            doctors={doctors}
            selected={doctorIds}
            onChange={setDoctorIds}
          />
          <PatientSingleSelect
            patients={patients}
            selectedId={patientId}
            onChange={setPatientId}
          />
          <RangePicker
            preset={preset}
            setPreset={setPreset}
            customFrom={customFrom}
            customTo={customTo}
            setCustomFrom={setCustomFrom}
            setCustomTo={setCustomTo}
          />
        </div>
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
        >
          <span className="overline">Status</span>
          {(["confirmed", "pending", "completed", "cancelled"] as const).map((s) => (
            <button
              key={s}
              className={`pill ${statuses.has(s) ? "active" : ""}`}
              onClick={() =>
                setStatuses((prev) => {
                  const next = new Set(prev);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
            >
              {s}
            </button>
          ))}
          {(doctorIds.size > 0 ||
            patientId ||
            statuses.size < 4 ||
            preset !== "week") && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setDoctorIds(new Set());
                setPatientId("");
                setStatuses(new Set(["confirmed", "pending"]));
                setPreset("week");
              }}
              style={{ marginLeft: "auto" }}
            >
              <Icon name="x" size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-row">
        <StatBlock
          label="Appointments"
          value={kpis.apptCount}
          hint="in selected range"
          icon="calendar-check"
        />
        <StatBlock
          label="Free slots"
          value={kpis.freeSlots}
          hint={`of ${kpis.totalSlots} capacity`}
          icon="circle-dashed"
          accent="active"
        />
        <StatBlock
          label="Booked slots"
          value={kpis.bookedSlots}
          hint="non-cancelled"
          icon="clipboard-check"
        />
        <StatBlock
          label="Doctors on duty"
          value={kpis.activeDoctors}
          hint={doctorIds.size > 0 ? "filtered" : "active total"}
          icon="users"
        />
      </div>

      {/* Main view */}
      {loadingAppointments && appointments.length === 0 ? (
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading appointments…
        </div>
      ) : view === "calendar" ? (
        <CalendarGrid
          doctors={selectedDoctors}
          days={days}
          apptIndex={apptIndex}
          onCellClick={(doctorId, day) => setFocus({ doctorId, day })}
          focus={focus}
          onOpenDoctor={(id) => navigate(`/doctors/${id}`)}
        />
      ) : (
        <AppointmentsTable
          appointments={filteredAppointments}
          patientsById={patientsById}
          onStatusChange={(id, next) =>
            setAppointments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, status: next } : a)),
            )
          }
        />
      )}

      {view === "calendar" && focus && (
        <DayFocusPanel
          doctor={doctors.find((d) => d.id === focus.doctorId) ?? null}
          day={focus.day}
          appointments={filteredAppointments}
          patientsById={patientsById}
          onClose={() => setFocus(null)}
          onStatusChange={(id, next) =>
            setAppointments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, status: next } : a)),
            )
          }
        />
      )}
    </div>
  );
}

// ─── Filter sub-components ────────────────────────────────────────────────

function DoctorMultiSelect({
  doctors,
  selected,
  onChange,
}: {
  doctors: Doctor[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const visible = useMemo(() => {
    if (!q) return doctors;
    const lc = q.toLowerCase();
    return doctors.filter(
      (d) => d.name.toLowerCase().includes(lc) || d.specialization.toLowerCase().includes(lc),
    );
  }, [doctors, q]);

  const label =
    selected.size === 0
      ? "All active doctors"
      : selected.size === 1
        ? doctors.find((d) => selected.has(d.id))?.name ?? "1 doctor"
        : `${selected.size} doctors`;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div className="overline" style={{ marginBottom: 6 }}>
        Doctors
      </div>
      <button
        className="input"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "left",
          cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="stethoscope" size={14} />
          {label}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: 6,
            maxHeight: 320,
            overflow: "auto",
          }}
        >
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search doctors..."
            autoFocus
            style={{ marginBottom: 6 }}
          />
          {visible.length === 0 && (
            <div
              style={{ padding: 12, color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}
            >
              No matches.
            </div>
          )}
          {visible.map((d) => {
            const checked = selected.has(d.id);
            return (
              <label
                key={d.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  cursor: "pointer",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "var(--text-sm)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "transparent")
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selected);
                    if (checked) next.delete(d.id);
                    else next.add(d.id);
                    onChange(next);
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {d.specialization} · {d.is_active ? "active" : "inactive"}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PatientSingleSelect({
  patients,
  selectedId,
  onChange,
}: {
  patients: Patient[];
  selectedId: string;
  onChange: (next: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = patients.find((p) => p.id === selectedId) ?? null;
  const visible = useMemo(() => {
    if (!q) return patients.slice(0, 30);
    const lc = q.toLowerCase();
    return patients
      .filter((p) => (p.name ?? "").toLowerCase().includes(lc) || p.phone.includes(q))
      .slice(0, 30);
  }, [patients, q]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div className="overline" style={{ marginBottom: 6 }}>
        Patient
      </div>
      <button
        className="input"
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="user" size={14} />
          {selected ? selected.name ?? selected.phone : "Any patient"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {selected && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              style={{ display: "inline-flex", color: "var(--text-tertiary)" }}
              title="Clear"
            >
              <Icon name="x" size={12} />
            </span>
          )}
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: 6,
            maxHeight: 320,
            overflow: "auto",
          }}
        >
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or phone..."
            autoFocus
            style={{ marginBottom: 6 }}
          />
          {visible.length === 0 && (
            <div
              style={{ padding: 12, color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}
            >
              No matches.
            </div>
          )}
          {visible.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                textAlign: "left",
                fontSize: "var(--text-sm)",
                background: selectedId === p.id ? "var(--brand-subtle)" : "transparent",
              }}
            >
              <span>{p.name ?? "Unknown"}</span>
              <span className="mono" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                {p.phone}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RangePicker({
  preset,
  setPreset,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
}: {
  preset: RangePreset;
  setPreset: (p: RangePreset) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (s: string) => void;
  setCustomTo: (s: string) => void;
}) {
  return (
    <div>
      <div className="overline" style={{ marginBottom: 6 }}>
        Date range
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div className="seg">
          {(["week", "2weeks", "month", "custom"] as RangePreset[]).map((p) => (
            <button
              key={p}
              className={preset === p ? "active" : ""}
              onClick={() => setPreset(p)}
            >
              {p === "week"
                ? "7d"
                : p === "2weeks"
                  ? "14d"
                  : p === "month"
                    ? "30d"
                    : "Custom"}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="date"
              className="input"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ width: 160 }}
            />
            <span style={{ color: "var(--text-tertiary)" }}>→</span>
            <input
              type="date"
              className="input"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI block ────────────────────────────────────────────────────────────

function StatBlock({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: string;
  accent?: "active";
}) {
  return (
    <div className={`kpi ${accent === "active" ? "active" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="label">{label}</div>
        <Icon name={icon} size={14} style={{ color: "var(--text-tertiary)" }} />
      </div>
      <div className="value">{value.toLocaleString()}</div>
      {hint && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            marginTop: 6,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ─── Calendar grid ────────────────────────────────────────────────────────

function CalendarGrid({
  doctors,
  days,
  apptIndex,
  onCellClick,
  focus,
  onOpenDoctor,
}: {
  doctors: Doctor[];
  days: Date[];
  apptIndex: Map<string, Appointment[]>;
  onCellClick: (doctorId: string, day: Date) => void;
  focus: { doctorId: string; day: Date } | null;
  onOpenDoctor: (id: string) => void;
}) {
  if (doctors.length === 0) {
    return (
      <div className="empty">
        <Icon name="stethoscope" size={28} style={{ color: "var(--text-tertiary)" }} />
        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>No doctors selected</div>
        <div>Pick one or more doctors, or clear the filter to see all active.</div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{ overflow: "auto", padding: 0 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(220px, 1.2fr) repeat(${days.length}, minmax(96px, 1fr))`,
          fontSize: "var(--text-sm)",
        }}
      >
        {/* Header row */}
        <div
          style={{
            padding: "12px 16px",
            background: "var(--bg-elevated)",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "var(--tracking-widest)",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            position: "sticky",
            left: 0,
            zIndex: 3,
          }}
        >
          Doctor
        </div>
        {days.map((d, i) => (
          <div
            key={i}
            style={{
              padding: "10px 8px",
              background: "var(--bg-elevated)",
              borderBottom: "1px solid var(--border-subtle)",
              textAlign: "center",
              fontSize: 11,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
                color: sameDay(d, new Date()) ? "var(--brand-400)" : "var(--text-secondary)",
              }}
            >
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 13,
                color: sameDay(d, new Date()) ? "var(--brand-400)" : "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {d.getDate()} {d.toLocaleDateString(undefined, { month: "short" })}
            </div>
          </div>
        ))}

        {/* Rows */}
        {doctors.map((doc, row) => {
          const [sh, eh] = parseHours(doc.available_hours);
          const capacity = Math.max(0, eh - sh);
          return (
            <>
              <button
                key={`name-${doc.id}`}
                type="button"
                onClick={() => onOpenDoctor(doc.id)}
                style={{
                  padding: "12px 16px",
                  background: "var(--bg-surface)",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                title="Open doctor profile"
              >
                <div
                  className="avatar"
                  style={{ width: 30, height: 30, fontSize: 11 }}
                >
                  {initialsFrom(doc.name.replace(/^Dr\. /, ""))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {doc.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-tertiary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {doc.specialization} · {doc.available_hours}
                  </div>
                </div>
              </button>

              {days.map((day) => {
                const works = doctorWorksOn(day, doc.available_days);
                const bucket = apptIndex.get(`${doc.name}|${isoDate(day)}`) ?? [];
                const booked = bucket.filter((a) => a.status !== "cancelled").length;
                const isFocus =
                  focus && focus.doctorId === doc.id && sameDay(focus.day, day);
                const isPast = day < startOfDay(new Date());

                let bg = "transparent";
                let fg = "var(--text-primary)";
                let hint = "Free";

                if (!works) {
                  bg = "var(--bg-elevated)";
                  fg = "var(--text-tertiary)";
                  hint = "Off";
                } else if (booked === 0) {
                  bg = "rgba(52, 211, 153, 0.08)";
                  fg = "var(--success)";
                  hint = "Free";
                } else if (booked >= capacity) {
                  bg = "rgba(248, 113, 113, 0.10)";
                  fg = "var(--danger)";
                  hint = "Full";
                } else {
                  bg = "rgba(251, 191, 36, 0.10)";
                  fg = "var(--warning)";
                  hint = "Partial";
                }

                return (
                  <button
                    key={`${doc.id}-${isoDate(day)}`}
                    type="button"
                    onClick={() => works && onCellClick(doc.id, day)}
                    disabled={!works}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      borderLeft: "1px solid var(--border-subtle)",
                      padding: 8,
                      textAlign: "center",
                      background: isFocus ? "var(--brand-subtle)" : bg,
                      color: fg,
                      cursor: works ? "pointer" : "default",
                      opacity: isPast ? 0.55 : 1,
                      position: "relative",
                      minHeight: 64,
                      transition: "background var(--duration-fast)",
                      boxShadow: isFocus
                        ? `inset 0 0 0 1px var(--brand-400)`
                        : undefined,
                    }}
                    title={
                      !works
                        ? `${doc.name} is off on ${day.toLocaleDateString(undefined, {
                            weekday: "long",
                          })}`
                        : `${booked}/${capacity} booked`
                    }
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 700,
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      {works ? `${booked}/${capacity}` : "—"}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        marginTop: 4,
                        letterSpacing: "var(--tracking-wide)",
                        textTransform: "uppercase",
                        color: "inherit",
                        opacity: works ? 0.8 : 0.55,
                      }}
                    >
                      {hint}
                    </div>
                    {row === 0 /* dummy to silence unused-var lint */ && null}
                  </button>
                );
              })}
            </>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day focus (slide-in) ─────────────────────────────────────────────────

function DayFocusPanel({
  doctor,
  day,
  appointments,
  patientsById,
  onClose,
  onStatusChange,
}: {
  doctor: Doctor | null;
  day: Date;
  appointments: Appointment[];
  patientsById: Record<string, Patient>;
  onClose: () => void;
  onStatusChange?: (id: string, next: "pending" | "confirmed" | "completed" | "cancelled") => void;
}) {
  if (!doctor) return null;
  const [sh, eh] = parseHours(doctor.available_hours);
  const slots = slotsForDay(day, sh, eh);

  const dayKey = isoDate(day);
  const dayAppts = appointments.filter(
    (a) =>
      doctorNameMatches(a.doctor_name, doctor.name) &&
      isoDate(new Date(a.scheduled_at)) === dayKey,
  );

  const byHour: Record<number, Appointment[]> = {};
  for (const a of dayAppts) {
    const h = new Date(a.scheduled_at).getHours();
    (byHour[h] ??= []).push(a);
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
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
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="chevron-left" size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
              {doctor.name} ·{" "}
              {day.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              {doctor.specialization} · {doctor.available_hours}
            </div>
          </div>
        </div>

        <div
          className="transcript-body"
          style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}
        >
          {slots.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
              No slots defined — check the doctor's available_hours.
            </div>
          ) : (
            slots.map((slot) => {
              const h = slot.getHours();
              const apps = byHour[h] ?? [];
              const isBooked = apps.some((a) => a.status !== "cancelled");
              return (
                <div
                  key={h}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    background: isBooked ? "var(--bg-elevated)" : "var(--bg-surface)",
                    border: `1px solid ${
                      isBooked ? "var(--border-default)" : "rgba(52,211,153,0.25)"
                    }`,
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
                    {formatTimePretty(slot.toISOString())}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isBooked ? (
                      apps.map((a) => {
                        const p = patientsById[a.patient_id];
                        return (
                          <div key={a.id}>
                            <span style={{ fontWeight: 500 }}>
                              {p ? (
                                <Link
                                  to={`/patients/${p.id}`}
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {p.name ?? "Unknown"}
                                </Link>
                              ) : (
                                "Unknown patient"
                              )}
                            </span>
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
                        );
                      })
                    ) : (
                      <span
                        style={{
                          color: "var(--success)",
                          fontSize: "var(--text-sm)",
                          fontWeight: 500,
                        }}
                      >
                        Free
                      </span>
                    )}
                  </div>
                  {isBooked &&
                    apps.map((a) => (
                      <AppointmentStatusSelect
                        key={`b-${a.id}`}
                        appointmentId={a.id}
                        status={a.status}
                        onChange={onStatusChange ? (next) => onStatusChange(a.id, next) : undefined}
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ─── List view ────────────────────────────────────────────────────────────

function AppointmentsTable({
  appointments,
  patientsById,
  onStatusChange,
}: {
  appointments: Appointment[];
  patientsById: Record<string, Patient>;
  onStatusChange?: (id: string, next: "pending" | "confirmed" | "completed" | "cancelled") => void;
}) {
  if (appointments.length === 0) {
    return (
      <div className="empty">
        <Icon name="calendar-x" size={28} style={{ color: "var(--text-tertiary)" }} />
        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          No matching appointments
        </div>
        <div>Adjust the filters or date range above.</div>
      </div>
    );
  }
  const sorted = [...appointments].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  );
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Doctor</th>
            <th>Patient</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const p = patientsById[a.patient_id];
            return (
              <tr key={a.id} style={{ cursor: "default" }}>
                <td className="mono">{formatDatePretty(a.scheduled_at)}</td>
                <td className="mono">{formatTimePretty(a.scheduled_at)}</td>
                <td style={{ fontWeight: 500 }}>{a.doctor_name}</td>
                <td>
                  {p ? (
                    <Link to={`/patients/${p.id}`}>{p.name ?? p.phone}</Link>
                  ) : (
                    <span style={{ color: "var(--text-tertiary)" }}>—</span>
                  )}
                </td>
                <td>
                  <AppointmentStatusSelect
                    appointmentId={a.id}
                    status={a.status}
                    onChange={onStatusChange ? (next) => onStatusChange(a.id, next) : undefined}
                  />
                </td>
                <td style={{ color: "var(--text-secondary)", maxWidth: 320 }}>
                  {a.notes ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
