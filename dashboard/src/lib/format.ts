// dashboard/src/lib/format.ts
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return "***";
  return `${phone.slice(0, 2)} (XXX) XXX-${phone.slice(-4)}`;
}

export function formatDuration(seconds: number | null): string {
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
