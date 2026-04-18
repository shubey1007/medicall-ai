// dashboard/src/pages/EditPatient.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";
import { formatDatePretty } from "@/lib/format";
import type { Patient } from "@/types";

type CtxEntry = { id: string; key: string; value: string };

// medical_context is an open-ended JSON blob. We present a small set of
// "known" structured inputs (allergies/conditions/medications as CSV, plus
// age and blood type as single values) and a generic key/value editor for
// anything else the schema happens to contain now or in the future. Keeps
// the UI stable even if medical_context grows new fields.
const STRUCTURED_ARRAY_KEYS = ["allergies", "conditions", "medications"] as const;
const STRUCTURED_SCALAR_KEYS = ["age", "bloodType"] as const;
const RESERVED_KEYS = new Set<string>([...STRUCTURED_ARRAY_KEYS, ...STRUCTURED_SCALAR_KEYS]);

function csvJoin(v: unknown): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return "";
}

function csvSplit(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function EditPatient() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);

  // Structured fields
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [allergies, setAllergies] = useState("");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [age, setAge] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [extras, setExtras] = useState<CtxEntry[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<Patient>(`/api/patients/${id}`)
      .then((r) => {
        const p = r.data;
        setPatient(p);
        setPhone(p.phone);
        setName(p.name ?? "");
        const ctx = (p.medical_context ?? {}) as Record<string, unknown>;
        setAllergies(csvJoin(ctx.allergies));
        setConditions(csvJoin(ctx.conditions));
        setMedications(csvJoin(ctx.medications));
        setAge(ctx.age == null ? "" : String(ctx.age));
        setBloodType(typeof ctx.bloodType === "string" ? ctx.bloodType : "");
        const rest: CtxEntry[] = [];
        for (const [k, v] of Object.entries(ctx)) {
          if (RESERVED_KEYS.has(k)) continue;
          const value =
            typeof v === "string" || typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : JSON.stringify(v);
          rest.push({ id: uid(), key: k, value });
        }
        setExtras(rest);
      })
      .catch(() => setError("Could not load patient."))
      .finally(() => setLoading(false));
  }, [id]);

  const composedContext = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (allergies.trim()) out.allergies = csvSplit(allergies);
    if (conditions.trim()) out.conditions = csvSplit(conditions);
    if (medications.trim()) out.medications = csvSplit(medications);
    if (age.trim()) {
      const asNum = Number(age);
      out.age = Number.isFinite(asNum) ? asNum : age.trim();
    }
    if (bloodType.trim()) out.bloodType = bloodType.trim();
    for (const e of extras) {
      const k = e.key.trim();
      if (!k || RESERVED_KEYS.has(k)) continue;
      // Preserve non-empty scalars as strings; caller can JSON-edit if needed.
      if (e.value.trim() !== "") out[k] = e.value;
    }
    return out;
  }, [allergies, conditions, medications, age, bloodType, extras]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!patient) return;
    if (!phone.trim()) {
      setError("Phone number is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.put<Patient>(`/api/patients/${patient.id}`, {
        phone: phone.trim(),
        name: name.trim() || null,
        medical_context: composedContext,
      });
      setPatient(res.data);
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

  function addExtra() {
    setExtras((xs) => [...xs, { id: uid(), key: "", value: "" }]);
  }
  function updateExtra(eid: string, patch: Partial<CtxEntry>) {
    setExtras((xs) => xs.map((x) => (x.id === eid ? { ...x, ...patch } : x)));
  }
  function removeExtra(eid: string) {
    setExtras((xs) => xs.filter((x) => x.id !== eid));
  }

  if (loading) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading patient…
        </div>
      </div>
    );
  }
  if (!patient) {
    return (
      <div className="page">
        <div className="empty" style={{ color: "var(--danger)" }}>
          Patient not found.
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
            onClick={() => navigate(`/patients/${patient.id}`)}
            style={{ marginBottom: 8 }}
          >
            <Icon name="chevron-left" size={14} /> Back to patient
          </button>
          <h1 className="page-title">Edit Patient</h1>
          <div className="page-sub">Every field is editable except the system ID.</div>
        </div>
        <div className="page-actions">
          {savedAt && (
            <span style={{ color: "var(--success)", fontSize: "var(--text-sm)" }}>Saved</span>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => navigate(`/patients/${patient.id}`)}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-patient-form"
            className="btn btn-primary"
            disabled={saving}
          >
            <Icon name="check" size={14} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <form
        id="edit-patient-form"
        onSubmit={save}
        style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}
      >
        {/* Read-only system metadata */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            System metadata
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <ReadOnly label="Patient ID" value={patient.id} mono />
            <ReadOnly label="Created" value={formatDatePretty(patient.created_at)} />
            <ReadOnly label="Last updated" value={formatDatePretty(patient.updated_at)} />
          </div>
        </div>

        {/* Identity */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            Identity
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Full name">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>
            <Field label="Phone *">
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+14155550123"
                required
              />
            </Field>
          </div>
        </div>

        {/* Medical context — structured */}
        <div className="card" style={{ padding: 20 }}>
          <div className="overline" style={{ marginBottom: 12 }}>
            Medical context
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <Field label="Allergies (comma-separated)">
              <input
                className="input"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="Penicillin, Peanuts"
              />
            </Field>
            <Field label="Conditions (comma-separated)">
              <input
                className="input"
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                placeholder="Hypertension, Asthma"
              />
            </Field>
            <Field label="Medications (comma-separated)">
              <input
                className="input"
                value={medications}
                onChange={(e) => setMedications(e.target.value)}
                placeholder="Lisinopril, Metformin"
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Age">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={150}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </Field>
              <Field label="Blood type">
                <select
                  className="input"
                  value={bloodType}
                  onChange={(e) => setBloodType(e.target.value)}
                >
                  <option value="">—</option>
                  {["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </div>

        {/* Extra medical_context keys — schema-agnostic */}
        <div className="card" style={{ padding: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div>
              <div className="overline">Other attributes</div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  marginTop: 4,
                }}
              >
                Anything else stored in this patient's medical_context.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={addExtra}
            >
              <Icon name="plus" size={12} /> Add attribute
            </button>
          </div>

          {extras.length === 0 ? (
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-tertiary)",
                padding: "8px 0",
              }}
            >
              No other attributes. Click "Add attribute" to store a custom key.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {extras.map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "220px 1fr 36px",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    className="input"
                    value={e.key}
                    onChange={(ev) => updateExtra(e.id, { key: ev.target.value })}
                    placeholder="key (e.g. insurance_id)"
                  />
                  <input
                    className="input"
                    value={e.value}
                    onChange={(ev) => updateExtra(e.id, { value: ev.target.value })}
                    placeholder="value"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeExtra(e.id)}
                    title="Remove"
                  >
                    <Icon name="trash-2" size={14} style={{ color: "var(--danger)" }} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
