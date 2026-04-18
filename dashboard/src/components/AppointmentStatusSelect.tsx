// dashboard/src/components/AppointmentStatusSelect.tsx
// Inline dropdown editor for Appointment.status. Click the badge, pick a new
// status, it PUTs to /api/appointments/{id}. Used in Appointments page and
// any calendar/detail views that list appointments.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled";

const STATUS_ORDER: AppointmentStatus[] = ["pending", "confirmed", "completed", "cancelled"];

const BADGE_CLASS: Record<AppointmentStatus, string> = {
  pending: "badge-warning",
  confirmed: "badge-success",
  completed: "badge-info",
  cancelled: "badge-danger",
};

interface Props {
  appointmentId: string;
  status: AppointmentStatus;
  onChange?: (next: AppointmentStatus) => void;
  /** If provided, called if the PUT fails so the caller can toast/revert. */
  onError?: (msg: string) => void;
  /** Disable the dropdown (e.g. while another mutation is in-flight). */
  disabled?: boolean;
}

export default function AppointmentStatusSelect({
  appointmentId,
  status,
  onChange,
  onError,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function pick(next: AppointmentStatus) {
    setOpen(false);
    if (next === status) return;
    setSaving(true);
    try {
      await api.put(`/api/appointments/${appointmentId}`, { status: next });
      onChange?.(next);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to update status";
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled && !saving) setOpen((v) => !v);
        }}
        className={`badge ${BADGE_CLASS[status]}`}
        style={{
          cursor: disabled || saving ? "default" : "pointer",
          display: "inline-flex",
          gap: 4,
          opacity: disabled || saving ? 0.7 : 1,
        }}
        disabled={disabled || saving}
        title={disabled ? "Read-only" : "Change status"}
      >
        {status}
        {!disabled && (
          <Icon
            name={saving ? "loader" : "chevron-down"}
            size={10}
            strokeWidth={2.5}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: 4,
            minWidth: 140,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-xs)",
                textAlign: "left",
                background: s === status ? "var(--bg-elevated)" : "transparent",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  s === status ? "var(--bg-elevated)" : "transparent")
              }
            >
              <span
                className={`badge ${BADGE_CLASS[s]}`}
                style={{ height: 16, padding: "0 6px", fontSize: 9 }}
              >
                {s}
              </span>
              {s === status && (
                <Icon
                  name="check"
                  size={11}
                  style={{ marginLeft: "auto", color: "var(--brand-400)" }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
