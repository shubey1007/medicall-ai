// dashboard/src/pages/Settings.tsx
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

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

const PROFILE_KEY = "medicall_admin_profile";

function loadProfile(): AdminProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as AdminProfile;
  } catch {}
  return { name: "Admin", email: "", role: "Administrator" };
}

export default function Settings() {
  const [profile, setProfile] = useState<AdminProfile>(loadProfile);
  const [editProfile, setEditProfile] = useState<AdminProfile>(loadProfile);
  const [editingProfile, setEditingProfile] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<HealthResponse>("/health").then((r) => setHealth(r.data)).catch(() => {});
  }, []);

  function saveProfile() {
    setProfile(editProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(editProfile));
    setEditingProfile(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      {/* Admin profile */}
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
              <input value={editProfile.name} onChange={(e) => setEditProfile({ ...editProfile, name: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </Field>
            <Field label="Email">
              <input type="email" value={editProfile.email} onChange={(e) => setEditProfile({ ...editProfile, email: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" placeholder="admin@clinic.com" />
            </Field>
            <Field label="Role">
              <input value={editProfile.role} onChange={(e) => setEditProfile({ ...editProfile, role: e.target.value })}
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
            {saved && <p className="text-green-600 text-sm">Profile saved.</p>}
          </div>
        )}
      </section>

      {/* System info */}
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

      {/* Notification preferences (stored in localStorage) */}
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
