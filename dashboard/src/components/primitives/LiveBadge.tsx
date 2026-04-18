interface LiveBadgeProps {
  emergency?: boolean;
  label?: string;
}

export default function LiveBadge({ emergency = false, label = "LIVE" }: LiveBadgeProps) {
  return (
    <span className={`badge ${emergency ? "badge-danger" : "badge-live"}`}>
      <span className="dot" style={emergency ? { background: "var(--danger)" } : undefined} />
      {label}
    </span>
  );
}
