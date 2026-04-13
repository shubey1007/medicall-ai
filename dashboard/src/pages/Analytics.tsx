// dashboard/src/pages/Analytics.tsx
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/api";

interface Summary {
  total_calls: number;
  active_calls: number;
  completed_calls: number;
  average_duration_seconds: number;
  urgency_breakdown: { low: number; medium: number; high: number; critical: number };
  calls_per_day: { date: string; count: number }[];
}

interface AgentStats {
  agents: { agent_name: string; message_count: number }[];
}

const URGENCY_COLORS = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#ef4444",
  critical: "#991b1b",
};

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);

  useEffect(() => {
    api.get<Summary>("/api/analytics/summary").then((r) => setSummary(r.data));
    api.get<AgentStats>("/api/analytics/agents").then((r) => setAgentStats(r.data));
  }, []);

  if (!summary || !agentStats) return <div>Loading...</div>;

  const urgencyData = Object.entries(summary.urgency_breakdown).map(([name, value]) => ({
    name, value,
  }));

  const callsData = summary.calls_per_day.map((d) => ({
    date: d.date.slice(5, 10),
    count: d.count,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Calls per Day (last 14 days)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={callsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Urgency Distribution">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={urgencyData} dataKey="value" nameKey="name" outerRadius={90} label>
                {urgencyData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={URGENCY_COLORS[entry.name as keyof typeof URGENCY_COLORS]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Agent Usage">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={agentStats.agents} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="agent_name" />
              <Tooltip />
              <Bar dataKey="message_count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Summary Stats">
          <div className="grid grid-cols-2 gap-4 h-full">
            <Stat label="Total Calls" value={summary.total_calls} />
            <Stat label="Active" value={summary.active_calls} />
            <Stat label="Completed" value={summary.completed_calls} />
            <Stat label="Avg Duration" value={`${Math.floor(summary.average_duration_seconds)}s`} />
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center justify-center bg-slate-50 rounded p-3">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
