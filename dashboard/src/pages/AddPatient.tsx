// dashboard/src/pages/AddPatient.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";

export default function AddPatient() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [allergies, setAllergies] = useState("");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) {
      setError("Phone number is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const medical_context: Record<string, string[]> = {};
      if (allergies.trim())
        medical_context.allergies = allergies.split(",").map((s) => s.trim()).filter(Boolean);
      if (conditions.trim())
        medical_context.conditions = conditions.split(",").map((s) => s.trim()).filter(Boolean);
      if (medications.trim())
        medical_context.medications = medications.split(",").map((s) => s.trim()).filter(Boolean);
      await api.post("/api/patients", {
        phone: phone.trim(),
        name: name.trim() || null,
        medical_context,
      });
      navigate("/patients");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to create patient.";
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
            onClick={() => navigate("/patients")}
            style={{ marginBottom: 8 }}
          >
            <Icon name="chevron-left" size={14} /> Back
          </button>
          <h1 className="page-title">Add Patient</h1>
          <div className="page-sub">Register a new patient in the clinic directory</div>
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
        <Field label="Phone Number *">
          <input
            type="tel"
            className="input"
            placeholder="+1234567890"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <Field label="Full Name">
          <input
            type="text"
            className="input"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Allergies (comma-separated)">
          <input
            type="text"
            className="input"
            placeholder="Penicillin, Peanuts"
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
          />
        </Field>
        <Field label="Conditions (comma-separated)">
          <input
            type="text"
            className="input"
            placeholder="Diabetes, Hypertension"
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
          />
        </Field>
        <Field label="Medications (comma-separated)">
          <input
            type="text"
            className="input"
            placeholder="Metformin, Lisinopril"
            value={medications}
            onChange={(e) => setMedications(e.target.value)}
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
            <Icon name="check" size={14} /> {submitting ? "Saving..." : "Save Patient"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate("/patients")}
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
