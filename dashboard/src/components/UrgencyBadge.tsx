// dashboard/src/components/UrgencyBadge.tsx
import type { UrgencyLevel } from "@/types";

const COLORS: Record<UrgencyLevel, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-200 text-red-900 font-bold",
};

export default function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded uppercase ${COLORS[level]}`}>
      {level}
    </span>
  );
}
