// dashboard/src/pages/Settings.tsx
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HealthResponse {
  status: string;
  environment: string;
  version?: string;
}

interface AdminProfile {
  name: string;
  email: string;
  role: string;
}

interface SettingMeta {
  value: string;               // actual value for non-secrets; "" for secrets (redacted)
  source: "db" | "env" | "unset";
  is_set: boolean;             // true if a value exists (from DB or .env)
}

// ─── Credential groups displayed in the UI ────────────────────────────────────

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
}

interface CredentialGroup {
  title: string;
  icon: string;
  fields: CredentialField[];
}

const CREDENTIAL_GROUPS: CredentialGroup[] = [
  {
    title: "OpenAI",
    icon: "🤖",
    fields: [
      { key: "openai_api_key", label: "API Key", placeholder: "sk-...", secret: true },
      { key: "openai_realtime_model", label: "Realtime Model", placeholder: "gpt-4o-realtime-preview" },
      { key: "post_call_summary_model", label: "Summary Model", placeholder: "gpt-4o-mini" },
    ],
  },
  {
    title: "Twilio",
    icon: "📞",
    fields: [
      { key: "twilio_account_sid", label: "Account SID", placeholder: "AC..." },
      { key: "twilio_auth_token", label: "Auth Token", secret: true },
      { key: "twilio_phone_number", label: "Phone Number", placeholder: "+1234567890" },
      { key: "twilio_webhook_url", label: "Webhook URL", placeholder: "https://your-ngrok.ngrok.io" },
    ],
  },
  {
    title: "Vapi",
    icon: "🎙️",
    fields: [
      { key: "vapi_api_key", label: "API Key", placeholder: "vapi_...", secret: true },
      {
        key: "vapi_phone_number_id",
        label: "Phone Number ID (UUID, not the phone number)",
        placeholder: "e.g. 01234567-89ab-cdef-0123-456789abcdef",
      },
      { key: "public_url", label: "Public URL (ngrok)", placeholder: "https://your-ngrok.ngrok.io" },
    ],
  },
  {
    title: "Qdrant",
    icon: "🧠",
    fields: [
      { key: "qdrant_url", label: "Cluster URL", placeholder: "https://your-cluster.qdrant.tech" },
      { key: "qdrant_api_key", label: "API Key", secret: true },
    ],
  },
  {
    title: "Notifications & Emergency",
    icon: "🚨",
    fields: [
      { key: "oncall_phone_number", label: "On-Call Phone Number", placeholder: "+1234567890" },
    ],
  },
  {
    title: "Clinic",
    icon: "🏥",
    fields: [
      {
        key: "clinic_timezone",
        label: "Clinic Timezone (IANA)",
        placeholder: "Asia/Kolkata · America/New_York · Europe/London",
      },
    ],
  },
  {
    title: "Google Sheets (optional)",
    icon: "📊",
    fields: [
      {
        key: "google_sheets_credentials_json",
        label: "Service Account JSON",
        placeholder: '{"type":"service_account",...}',
        secret: true,
        multiline: true,
      },
      {
        key: "google_sheets_spreadsheet_id",
        label: "Spreadsheet ID",
        placeholder: "1BxiMVs0...",
      },
    ],
  },
];

const PROFILE_KEY = "medicall_admin_profile";

function loadProfile(): AdminProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as AdminProfile;
  } catch {}
  return { name: "Admin", email: "", role: "Administrator" };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Settings() {
  const [profile, setProfile] = useState<AdminProfile>(loadProfile);
  const [editProfile, setEditProfile] = useState<AdminProfile>(loadProfile);
  const [editingProfile, setEditingProfile] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  // Credentials state
  //   originals: last saved value from backend per key (for dirty check)
  //   values:    current content of each input field
  //   sources:   where each value came from (db | env | unset)
  //   setFlags:  whether the backend reports the key as already configured
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, "db" | "env" | "unset">>({});
  const [setFlags, setSetFlags] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [savedGroup, setSavedGroup] = useState<string | null>(null);
  const [credError, setCredError] = useState<string>("");

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get<Record<string, SettingMeta>>("/api/settings");
      const vals: Record<string, string> = {};
      const srcs: Record<string, "db" | "env" | "unset"> = {};
      const flags: Record<string, boolean> = {};
      for (const [key, meta] of Object.entries(res.data)) {
        vals[key] = meta.value;
        srcs[key] = meta.source;
        flags[key] = meta.is_set;
      }
      setOriginals(vals);
      setValues(vals);
      setSources(srcs);
      setSetFlags(flags);
    } catch {
      // backend may not be running; silently skip
    }
  }, []);

  useEffect(() => {
    api.get<HealthResponse>("/health").then((r) => setHealth(r.data)).catch(() => {});
    loadSettings();
  }, [loadSettings]);

  function saveProfile() {
    setProfile(editProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(editProfile));
    setEditingProfile(false);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  }

  async function saveGroup(group: CredentialGroup) {
    setSavingGroup(group.title);
    setCredError("");
    try {
      const payload: Record<string, string> = {};
      for (const field of group.fields) {
        const current = values[field.key] ?? "";
        const original = originals[field.key] ?? "";
        // For secrets: original is always "" (backend redacts). Only send when
        // the user actually typed something. Empty input for a secret means
        // "keep existing".
        if (field.secret) {
          if (current.trim()) payload[field.key] = current;
        } else if (current !== original) {
          payload[field.key] = current;
        }
      }
      if (Object.keys(payload).length === 0) {
        setSavingGroup(null);
        return;
      }
      await api.put("/api/settings", { settings: payload });
      // Clear secret inputs after save (otherwise they'd show what was just entered)
      setValues((prev) => {
        const next = { ...prev };
        for (const field of group.fields) {
          if (field.secret) next[field.key] = "";
        }
        return next;
      });
      await loadSettings();
      setSavedGroup(group.title);
      setTimeout(() => setSavedGroup(null), 2500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        `Failed to save ${group.title} settings.`;
      setCredError(msg);
    } finally {
      setSavingGroup(null);
    }
  }

  function isDirty(group: CredentialGroup): boolean {
    return group.fields.some((f) => {
      const cur = values[f.key] ?? "";
      const orig = originals[f.key] ?? "";
      // Secret fields: dirty only when the user has typed new text
      if (f.secret) return cur.trim() !== "";
      return cur !== orig;
    });
  }

  function toggleVisibility(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function sourceBadge(source: "db" | "env" | "unset") {
    if (source === "db")
      return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">DB</span>;
    if (source === "env")
      return <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">.env</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-600">unset</span>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      {/* ── Admin profile ── */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Admin Profile</h2>
          {!editingProfile && (
            <button onClick={() => { setEditProfile(profile); setEditingProfile(true); }}
              className="text-sm text-blue-600 hover:underline">
              Edit
            </button>
          )}
        </div>

        {editingProfile ? (
          <div className="space-y-3">
            <Field label="Name">
              <input value={editProfile.name}
                onChange={(e) => setEditProfile({ ...editProfile, name: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </Field>
            <Field label="Email">
              <input type="email" value={editProfile.email}
                onChange={(e) => setEditProfile({ ...editProfile, email: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="admin@clinic.com" />
            </Field>
            <Field label="Role">
              <input value={editProfile.role}
                onChange={(e) => setEditProfile({ ...editProfile, role: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={saveProfile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded">
                Save Changes
              </button>
              <button onClick={() => setEditingProfile(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
                {profile.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-semibold text-slate-900">{profile.name}</div>
                <div className="text-sm text-slate-500">{profile.email || "No email set"}</div>
                <div className="text-xs text-slate-400 mt-0.5">{profile.role}</div>
              </div>
            </div>
            {profileSaved && <p className="text-green-600 text-sm">Profile saved.</p>}
          </div>
        )}
      </section>

      {/* ── API Credentials ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold text-slate-900">API Credentials</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Values saved here are stored in the database and override <code className="bg-slate-100 px-1 rounded">.env</code> at runtime.
          Each field shows its current effective value and where it came from — edit inline and hit <strong>Save</strong>.
          Clear a field to revert to the <code className="bg-slate-100 px-1 rounded">.env</code> fallback.
        </p>

        {credError && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            {credError}
          </div>
        )}

        <div className="space-y-4">
          {CREDENTIAL_GROUPS.map((group) => {
            const isSaving = savingGroup === group.title;
            const justSaved = savedGroup === group.title;
            const dirty = isDirty(group);

            return (
              <section key={group.title} className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <span>{group.icon}</span> {group.title}
                  </h3>
                  <div className="flex items-center gap-2">
                    {justSaved && (
                      <span className="text-green-600 text-xs font-medium">Saved</span>
                    )}
                    <button
                      onClick={() => saveGroup(group)}
                      disabled={isSaving || !dirty}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium rounded"
                    >
                      {isSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {group.fields.map((field) => {
                    const source = sources[field.key] ?? "unset";
                    const isSet = setFlags[field.key] ?? false;
                    const isVisible = visibleKeys.has(field.key);
                    const inputType = field.secret && !isVisible ? "password" : "text";

                    // For secrets, the backend never sends the value. Placeholder
                    // communicates whether it's configured.
                    const placeholder = field.secret
                      ? (isSet
                          ? "●●●●●●●●●● — already configured, type to replace"
                          : (field.placeholder ?? "Enter value..."))
                      : (field.placeholder ?? "");

                    return (
                      <div key={field.key}>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-xs text-slate-500 uppercase font-medium">
                            {field.label}
                          </label>
                          {sourceBadge(source)}
                        </div>

                        <div className="relative">
                          {field.multiline ? (
                            <textarea
                              rows={4}
                              value={values[field.key] ?? ""}
                              onChange={(e) =>
                                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                              }
                              placeholder={placeholder}
                              className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono resize-none"
                            />
                          ) : (
                            <input
                              type={inputType}
                              value={values[field.key] ?? ""}
                              onChange={(e) =>
                                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                              }
                              placeholder={placeholder}
                              autoComplete={field.secret ? "new-password" : "off"}
                              className="w-full border border-slate-300 rounded px-3 py-2 text-sm pr-16"
                            />
                          )}
                          {field.secret && !field.multiline && (values[field.key] ?? "") !== "" && (
                            <button
                              type="button"
                              onClick={() => toggleVisibility(field.key)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 text-xs font-medium px-1.5 py-0.5 rounded hover:bg-slate-100"
                              tabIndex={-1}
                            >
                              {isVisible ? "Hide" : "Show"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* ── System info ── */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">System Info</h2>
        <dl className="space-y-3">
          <InfoRow label="Backend status" value={
            health ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                {health.status}
              </span>
            ) : (
              <span className="text-slate-400">Checking...</span>
            )
          } />
          <InfoRow label="Environment" value={health?.environment ?? "—"} />
          <InfoRow label="Dashboard" value="MediCall AI v1.0" />
          <InfoRow label="API docs" value={
            <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline text-sm">
              http://localhost:8000/docs
            </a>
          } />
        </dl>
      </section>

      {/* ── Notifications ── */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Notifications</h2>
        <div className="space-y-3">
          <Toggle
            label="Show desktop notifications for new calls"
            storageKey="notif_new_calls"
            defaultValue={true}
          />
          <Toggle
            label="Show desktop notifications for emergency escalations"
            storageKey="notif_emergency"
            defaultValue={true}
          />
          <Toggle
            label="Auto-expand transcript for active calls"
            storageKey="notif_auto_expand"
            defaultValue={false}
          />
        </div>
      </section>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 uppercase mb-1">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function Toggle({ label, storageKey, defaultValue }: { label: string; storageKey: string; defaultValue: boolean }) {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? stored === "true" : defaultValue;
  });

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem(storageKey, String(next));
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-700">{label}</span>
      <button
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-slate-300"}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
