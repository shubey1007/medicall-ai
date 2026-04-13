// dashboard/src/components/AgentStatusBadge.tsx
const AGENT_COLORS: Record<string, string> = {
  triage: "bg-blue-100 text-blue-800",
  scheduling: "bg-purple-100 text-purple-800",
  medication: "bg-teal-100 text-teal-800",
  emergency: "bg-red-100 text-red-800",
};

export default function AgentStatusBadge({ agent }: { agent: string }) {
  const color = AGENT_COLORS[agent] || "bg-slate-100 text-slate-800";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${color}`}>
      {agent}
    </span>
  );
}
