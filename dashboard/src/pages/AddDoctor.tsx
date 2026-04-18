// dashboard/src/pages/AddDoctor.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";

const ALL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export default function AddDoctor() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [availableDays, setAvailableDays] = useState<string[]>([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ]);
  const [availableHours, setAvailableHours] = useState("09:00-17:00");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleDay(day: string) {
    setAvailableDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !specialization.trim()) {
      setError("Name and specialization are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.post("/api/doctors", {
        name: name.trim(),
        specialization: specialization.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        available_days: availableDays,
        available_hours: availableHours,
        bio: bio.trim() || null,
        is_active: true,
      });
      navigate("/doctors");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to create doctor.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
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
            <Icon name="chevron-left" size={14} /> Back
          </button>
          <h1 className="page-title">Add Doctor</h1>
          <div className="page-sub">Add a doctor so the Scheduling agent can book appointments</div>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="card"
        style={{
          padding: 24,
          maxWidth: 560,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <Field label="Full Name *">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dr. Priya Sharma"
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
            placeholder="+1234567890"
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
        <Field label="Available Days">
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
        <Field label="Available Hours">
          <input
            className="input"
            value={availableHours}
            onChange={(e) => setAvailableHours(e.target.value)}
            placeholder="09:00-17:00"
          />
        </Field>
        <Field label="Bio (optional)">
          <textarea
            className="input"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Brief background of the doctor..."
            style={{ resize: "vertical" }}
          />
        </Field>

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

        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <Icon name="check" size={14} /> {submitting ? "Saving..." : "Save Doctor"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate("/doctors")}
          >
            Cancel
          </button>
        </div>
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
