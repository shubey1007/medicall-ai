import type { UrgencyLevel } from "@/types";

interface UrgencyBarProps {
  level?: UrgencyLevel | string | null;
  showLabel?: boolean;
}

export default function UrgencyBar({ level, showLabel = true }: UrgencyBarProps) {
  const l = (level || "low").toLowerCase();
  return (
    <span className={`urg-bar urg-${l}`}>
      <span className="track">
        <span className="fill" />
      </span>
      {showLabel && <span className="label">{l}</span>}
    </span>
  );
}
