// dashboard/src/pages/EditDoctor.tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";
import { formatDatePretty } from "@/lib/format";
import type { Doctor } from "@/types";

const ALL_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export default function EditDoctor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [doctor, setDoctor] = useState<Doctor | null>(null);

  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [availableHours, setAvailableHours] = useState("");
  const [bio, setBio] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    // List endpoint is paginated, so fetch via list + filter by id — there's
    // no dedicated GET /api/doctors/:id, but the list is small enough.
    api
      .get<{ items: Doctor[] }>("/api/doctors", { params: { page_size: 100 } })
      .then((r) => {
        const found = r.data.items.find((d) => d.id === id);
        if (!found) {
          setError("Doctor not found.");
          return;
        }
        setDoctor(found);
        setName(found.name);
        setSpecialization(found.specialization);
        setPhone(found.phone ?? "");
        setEmail(found.email ?? "");
        setAvailableDays(found.available_days ?? []);
        setAvailableHours(found.available_hours ?? "");
        setBio(found.bio ?? "");
        setIsActive(found.is_active);
      })
      .catch(() => setError("Failed to load doctor."))
      .finally(() => setLoading(false));
  }, [id]);

  function toggleDay(day: string) {
    setAvailableDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor) return;
    if (!name.trim() || !specialization.trim()) {
      setError("Name and specialization are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.put<Doctor>(`/api/doctors/${doctor.id}`, {
        name: name.trim(),
        specialization: specialization.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        available_days: availableDays,
        available_hours: availableHours.trim() || "09:00-17:00",
        bio: bio.trim() || null,
        is_active: isActive,
      });
      setDoctor(res.data);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to save.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading doctor…
        </div>
      </div>
    );
  }
  if (!doctor) {
    return (
      <div className="page">
        <div className="empty" style={{ color: "var(--danger)" }}>
          {error || "Doctor not found."}
        </div>
      </div>
    );
  }

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
          <h1 className="page-title">Edit Doctor</h1>
          <div className="page-sub">Every field is editable except the system ID.</div>
        </div>
        <div className="page-actions">
          {savedAt && (
            <span style={{ color: "var(--success)", fontSize: "var(--text-sm)" }}>Saved</span>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => navigate("/doctors")}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-doctor-form"
            className="btn btn-primary"
            disabled={saving}
          >
            <Icon name="check" size={14} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <form
        id="edit-doctor-form"
        onSubmit={save}
        style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}
      >
        {/* Read-only system metadata */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            System metadata
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <ReadOnly label="Doctor ID" value={doctor.id} mono />
            <ReadOnly label="Created" value={formatDatePretty(doctor.created_at)} />
          </div>
        </div>

        {/* Identity */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            Identity
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Full name *">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Jane Doe"
                required
              />
            </Field>
            <Field label="Specialization *">
              <input
                className="input"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="Cardiology"
                required
              />
            </Field>
            <Field label="Phone">
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+14155550123"
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@clinic.com"
              />
            </Field>
          </div>
        </div>

        {/* Availability */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            Availability
          </div>
          <Field label="Available days">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              {ALL_DAYS.map((day) => {
                const active = availableDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`pill ${active ? "active" : ""}`}
                  >
                    {DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Available hours">
            <input
              className="input"
              value={availableHours}
              onChange={(e) => setAvailableHours(e.target.value)}
              placeholder="09:00-17:00"
            />
          </Field>
        </div>

        {/* Bio + status */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            Profile
          </div>
          <Field label="Bio">
            <textarea
              className="input"
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short background, subspecialties, languages…"
              style={{ resize: "vertical" }}
            />
          </Field>
          <div style={{ height: 12 }} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 0",
            }}
          >
            <div>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Active</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                Inactive doctors are excluded from scheduling suggestions.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              style={{
                width: 40,
                height: 22,
                borderRadius: 999,
                background: isActive ? "var(--brand-400)" : "var(--border-default)",
                position: "relative",
                transition: "background var(--duration-fast)",
              }}
              aria-pressed={isActive}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: isActive ? 20 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "white",
                  transition: "left var(--duration-fast) var(--ease-spring)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: 10,
              background: "var(--danger-subtle)",
              border: "1px solid rgba(248,113,113,0.3)",
              color: "var(--danger)",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-sm)",
            }}
          >
            {error}
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="overline" style={{ marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ReadOnly({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="overline" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          padding: "7px 12px",
          background: "var(--bg-elevated)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-secondary)",
          fontSize: "var(--text-sm)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          userSelect: "all",
        }}
      >
        {value}
      </div>
    </div>
  );
}
