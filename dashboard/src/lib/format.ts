// dashboard/src/lib/format.ts
export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 5) return "***";
  return `${phone.slice(0, 3)} ⋯ ${phone.slice(-4)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function formatDatePretty(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimePretty(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function initialsFrom(name: string | null | undefined, fallback = "??"): string {
  if (!name) return fallback;
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Loose doctor-name key for matching Appointment.doctor_name against the
 * Doctor roster. Lowercases, strips whitespace and any "dr." prefix so that
 * "Dr. Sarah Smith" / "dr sarah smith" / "Sarah Smith" all collide. */
export function doctorKey(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.trim().toLowerCase();
  if (s.startsWith("dr.")) s = s.slice(3).trim();
  else if (s.startsWith("dr ")) s = s.slice(3).trim();
  return s.replace(/\s+/g, " ");
}

/** True if two names resolve to the same doctor under loose matching.
 * Falls back to substring match so "Smith" booked by the LLM still maps
 * to "Dr. Sarah Smith" in the roster. */
export function doctorNameMatches(
  appointmentName: string | null | undefined,
  rosterName: string | null | undefined,
): boolean {
  const a = doctorKey(appointmentName);
  const b = doctorKey(rosterName);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}
