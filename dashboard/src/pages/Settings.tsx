// dashboard/src/pages/Settings.tsx
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";
import { AGENTS } from "@/components/primitives/AgentPill";

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
  value: string;
  source: "db" | "env" | "unset";
  is_set: boolean;
}

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
    icon: "sparkles",
    fields: [
      { key: "openai_api_key", label: "API Key", placeholder: "sk-...", secret: true },
      { key: "openai_realtime_model", label: "Realtime Model", placeholder: "gpt-4o-realtime-preview" },
      { key: "post_call_summary_model", label: "Summary Model", placeholder: "gpt-4o-mini" },
    ],
  },
  {
    title: "Twilio",
    icon: "phone-call",
    fields: [
      { key: "twilio_account_sid", label: "Account SID", placeholder: "AC..." },
      { key: "twilio_auth_token", label: "Auth Token", secret: true },
      { key: "twilio_phone_number", label: "Phone Number", placeholder: "+1234567890" },
      { key: "twilio_webhook_url", label: "Webhook URL", placeholder: "https://your-ngrok.ngrok.io" },
    ],
  },
  {
    title: "Vapi",
    icon: "mic",
    fields: [
      { key: "vapi_api_key", label: "API Key", placeholder: "vapi_...", secret: true },
      {
        key: "vapi_phone_number_id",
        label: "Phone Number ID (UUID)",
        placeholder: "01234567-89ab-cdef-0123-456789abcdef",
      },
      { key: "public_url", label: "Public URL (ngrok)", placeholder: "https://your-ngrok.ngrok.io" },
    ],
  },
  {
    title: "Qdrant",
    icon: "database",
    fields: [
      { key: "qdrant_url", label: "Cluster URL", placeholder: "https://your-cluster.qdrant.tech" },
      { key: "qdrant_api_key", label: "API Key", secret: true },
    ],
  },
  {
    title: "Notifications & Emergency",
    icon: "alert-triangle",
    fields: [{ key: "oncall_phone_number", label: "On-Call Phone Number", placeholder: "+1234567890" }],
  },
  {
    title: "Clinic",
    icon: "building-2",
    fields: [
      {
        key: "clinic_timezone",
        label: "Clinic Timezone (IANA)",
        placeholder: "Asia/Kolkata · America/New_York",
      },
    ],
  },
  {
    title: "Google Sheets (optional)",
    icon: "table",
    fields: [
      {
        key: "google_sheets_credentials_json",
        label: "Service Account JSON",
        placeholder: '{"type":"service_account",...}',
        secret: true,
        multiline: true,
      },
      { key: "google_sheets_spreadsheet_id", label: "Spreadsheet ID", placeholder: "1BxiMVs0..." },
    ],
  },
];

const PROFILE_KEY = "medicall_admin_profile";

function loadProfile(): AdminProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as AdminProfile;
  } catch {
    // ignore
  }
  return { name: "Admin", email: "", role: "Administrator" };
}

const TABS = [
  { id: "general", label: "General", icon: "settings" },
  { id: "agents", label: "AI Agents", icon: "sparkles" },
  { id: "integrations", label: "Integrations", icon: "plug" },
  { id: "security", label: "Security", icon: "shield" },
  { id: "profile", label: "Profile", icon: "user" },
];

export default function Settings() {
  const [tab, setTab] = useState("integrations");
  const [profile, setProfile] = useState<AdminProfile>(loadProfile);
  const [editProfile, setEditProfile] = useState<AdminProfile>(loadProfile);
  const [profileSaved, setProfileSaved] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, "db" | "env" | "unset">>({});
  const [setFlags, setSetFlags] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [savedGroup, setSavedGroup] = useState<string | null>(null);
  const [credError, setCredError] = useState("");

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
      // ignore
    }
  }, []);

  useEffect(() => {
    api.get<HealthResponse>("/health").then((r) => setHealth(r.data)).catch(() => {});
    loadSettings();
  }, [loadSettings]);

  function saveProfile() {
    setProfile(editProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(editProfile));
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
    if (source === "db") return <span className="badge badge-success">DB</span>;
    if (source === "env") return <span className="badge badge-neutral">.env</span>;
    return <span className="badge badge-warning">unset</span>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Configure MediCall AI for your clinic</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, height: "fit-content" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`nav-item ${tab === t.id ? "active" : ""}`}
              style={{ justifyContent: "flex-start", width: "100%" }}
            >
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
          <div
            style={{
              marginTop: 20,
              padding: 14,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "var(--tracking-widest)",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
                marginBottom: 6,
              }}
            >
              Backend
            </div>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 2 }}>
              {health?.status ?? "Checking…"}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              {health?.environment ?? "—"}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          {tab === "general" && (
            <div>
              {credError && (
                <div
                  style={{
                    padding: 12,
                    marginBottom: 12,
                    background: "var(--danger-subtle)",
                    color: "var(--danger)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  {credError}
                </div>
              )}
              <div className="overline" style={{ marginBottom: 12 }}>
                Clinic
              </div>
              {CREDENTIAL_GROUPS.filter((g) => g.title === "Clinic" || g.title === "Notifications & Emergency").map((group) => (
                <SettingsGroup
                  key={group.title}
                  group={group}
                  values={values}
                  sources={sources}
                  setFlags={setFlags}
                  visibleKeys={visibleKeys}
                  toggleVisibility={toggleVisibility}
                  setValues={setValues}
                  saving={savingGroup === group.title}
                  justSaved={savedGroup === group.title}
                  dirty={isDirty(group)}
                  onSave={() => saveGroup(group)}
                  sourceBadge={sourceBadge}
                />
              ))}
            </div>
          )}

          {tab === "agents" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="overline">AI Agents</div>
              {Object.entries(AGENTS).map(([k, a]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: 14,
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: a.subtle,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: a.color,
                    }}
                  >
                    <Icon name={a.icon} size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: a.color }}>
                      {a.name} Agent
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                      Always enabled · system prompts configured in backend
                    </div>
                  </div>
                  <span className="badge badge-success">
                    <span className="dot" style={{ background: "var(--success)" }} /> Active
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === "integrations" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {credError && (
                <div
                  style={{
                    padding: 12,
                    background: "var(--danger-subtle)",
                    color: "var(--danger)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  {credError}
                </div>
              )}
              <div
                style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}
              >
                Values saved here are stored in the database and override <code>.env</code> at runtime.
                Clear a field to revert to the <code>.env</code> fallback.
              </div>
              {CREDENTIAL_GROUPS.filter((g) => !["Clinic", "Notifications & Emergency"].includes(g.title)).map((group) => (
                <SettingsGroup
                  key={group.title}
                  group={group}
                  values={values}
                  sources={sources}
                  setFlags={setFlags}
                  visibleKeys={visibleKeys}
                  toggleVisibility={toggleVisibility}
                  setValues={setValues}
                  saving={savingGroup === group.title}
                  justSaved={savedGroup === group.title}
                  dirty={isDirty(group)}
                  onSave={() => saveGroup(group)}
                  sourceBadge={sourceBadge}
                />
              ))}
            </div>
          )}

          {tab === "security" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="overline">Security</div>
              <div
                style={{
                  padding: 14,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                Authentication is handled server-side via JWT. See the <code>DASHBOARD_PASSWORD</code>{" "}
                env var on the backend to configure login.
              </div>
              <div
                style={{
                  padding: 14,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                PII redaction, HIPAA compliance, and audit logs are not enabled in this demo. See the
                design decisions doc for details.
              </div>
            </div>
          )}

          {tab === "profile" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="overline">Admin Profile</div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
                  {profile.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{profile.name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                    {profile.email || "No email set"} · {profile.role}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="overline" style={{ marginBottom: 6 }}>
                    Name
                  </div>
                  <input
                    className="input"
                    value={editProfile.name}
                    onChange={(e) => setEditProfile({ ...editProfile, name: e.target.value })}
                  />
                </div>
                <div>
                  <div className="overline" style={{ marginBottom: 6 }}>
                    Email
                  </div>
                  <input
                    className="input"
                    type="email"
                    value={editProfile.email}
                    onChange={(e) => setEditProfile({ ...editProfile, email: e.target.value })}
                    placeholder="admin@clinic.com"
                  />
                </div>
                <div>
                  <div className="overline" style={{ marginBottom: 6 }}>
                    Role
                  </div>
                  <input
                    className="input"
                    value={editProfile.role}
                    onChange={(e) => setEditProfile({ ...editProfile, role: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={saveProfile}>
                  <Icon name="check" size={14} /> Save profile
                </button>
                {profileSaved && (
                  <span
                    style={{ color: "var(--success)", fontSize: "var(--text-sm)", alignSelf: "center" }}
                  >
                    Profile saved.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface GroupProps {
  group: CredentialGroup;
  values: Record<string, string>;
  sources: Record<string, "db" | "env" | "unset">;
  setFlags: Record<string, boolean>;
  visibleKeys: Set<string>;
  toggleVisibility: (k: string) => void;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  justSaved: boolean;
  dirty: boolean;
  onSave: () => void;
  sourceBadge: (s: "db" | "env" | "unset") => React.ReactNode;
}

function SettingsGroup({
  group,
  values,
  sources,
  setFlags,
  visibleKeys,
  toggleVisibility,
  setValues,
  saving,
  justSaved,
  dirty,
  onSave,
  sourceBadge,
}: GroupProps) {
  return (
    <section
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--bg-elevated)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            <Icon name={group.icon} size={14} />
          </div>
          <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{group.title}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {justSaved && (
            <span style={{ color: "var(--success)", fontSize: "var(--text-xs)" }}>Saved</span>
          )}
          <button
            className="btn btn-sm btn-primary"
            onClick={onSave}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {group.fields.map((field) => {
          const source = sources[field.key] ?? "unset";
          const isSet = setFlags[field.key] ?? false;
          const isVisible = visibleKeys.has(field.key);
          const inputType = field.secret && !isVisible ? "password" : "text";
          const placeholder = field.secret
            ? isSet
              ? "●●●●●●●● — already configured, type to replace"
              : field.placeholder ?? "Enter value..."
            : field.placeholder ?? "";

          return (
            <div key={field.key}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <label className="overline">{field.label}</label>
                {sourceBadge(source)}
              </div>
              <div style={{ position: "relative" }}>
                {field.multiline ? (
                  <textarea
                    className="input"
                    rows={4}
                    value={values[field.key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    style={{ fontFamily: "var(--font-mono)" }}
                  />
                ) : (
                  <input
                    className="input"
                    type={inputType}
                    value={values[field.key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    autoComplete={field.secret ? "new-password" : "off"}
                    style={{ paddingRight: field.secret ? 60 : undefined }}
                  />
                )}
                {field.secret && !field.multiline && (values[field.key] ?? "") !== "" && (
                  <button
                    type="button"
                    onClick={() => toggleVisibility(field.key)}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                      padding: "4px 8px",
                      borderRadius: 4,
                    }}
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
}
