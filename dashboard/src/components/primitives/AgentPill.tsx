import Icon from "./Icon";

export const AGENTS: Record<
  string,
  { name: string; color: string; icon: string; subtle: string; short: string }
> = {
  triage: { name: "Triage", color: "var(--agent-triage)", icon: "stethoscope", subtle: "var(--agent-triage-subtle)", short: "Tri" },
  scheduling: { name: "Scheduling", color: "var(--agent-scheduling)", icon: "calendar-check", subtle: "var(--agent-scheduling-subtle)", short: "Sch" },
  medication: { name: "Medication", color: "var(--agent-medication)", icon: "pill", subtle: "var(--agent-medication-subtle)", short: "Med" },
  emergency: { name: "Emergency", color: "var(--agent-emergency)", icon: "alert-triangle", subtle: "var(--agent-emergency-subtle)", short: "Emg" },
};

interface AgentPillProps {
  agent: string;
  showIcon?: boolean;
  size?: "md" | "sm";
}

export default function AgentPill({ agent, showIcon = true, size = "md" }: AgentPillProps) {
  const key = (agent || "").toLowerCase();
  const a = AGENTS[key];
  if (!a) {
    return (
      <span
        className="agent-pill"
        style={{
          color: "var(--text-secondary)",
          background: "var(--bg-elevated)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {agent || "—"}
      </span>
    );
  }
  const iconName = a.icon;
  return (
    <span
      className={`agent-pill agent-${key}`}
      style={size === "sm" ? { height: 20, padding: "0 8px", fontSize: 10 } : undefined}
    >
      {showIcon && <Icon name={iconName} size={12} strokeWidth={2.2} />}
      {a.name}
    </span>
  );
}
