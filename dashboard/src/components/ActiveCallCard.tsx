// dashboard/src/components/ActiveCallCard.tsx
import { useEffect, useState } from "react";
import type { ActiveCall } from "@/types";
import Icon from "@/components/primitives/Icon";
import LiveBadge from "@/components/primitives/LiveBadge";
import AgentPill from "@/components/primitives/AgentPill";
import AgentJourney from "@/components/primitives/AgentJourney";
import UrgencyBar from "@/components/primitives/UrgencyBar";
import { useLiveTimer } from "@/components/primitives/hooks";
import { maskPhone } from "@/lib/format";

function AudioWaveform({
  active = true,
  intensity = 1,
  emergency = false,
  bars = 46,
}: {
  active?: boolean;
  intensity?: number;
  emergency?: boolean;
  bars?: number;
}) {
  const [heights, setHeights] = useState<number[]>(() => Array(bars).fill(30));
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      setHeights((prev) =>
        prev.map((_, i) => {
          const base = 18 + Math.sin(Date.now() / 220 + i * 0.55) * 22;
          const noise = Math.random() * 48 * intensity;
          const center = Math.cos((i / bars) * Math.PI) * 10;
          return Math.max(8, Math.min(100, base + noise + center));
        }),
      );
      setTimeout(tick, 80);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [active, bars, intensity]);

  return (
    <div className="acc-waveform">
      {heights.map((h, i) => (
        <div
          key={i}
          className="bar"
          style={{
            height: `${h}%`,
            background: emergency ? "var(--danger)" : "var(--brand-400)",
            boxShadow: emergency
              ? "0 0 8px rgba(248,113,113,0.4)"
              : "0 0 8px rgba(0,229,208,0.4)",
            opacity: 0.4 + (h / 100) * 0.6,
          }}
        />
      ))}
    </div>
  );
}

interface Props {
  call: ActiveCall;
  onOpen: (call: ActiveCall) => void;
  agentPath?: string[];
  urgency?: string;
  symptoms?: string[];
  action?: string;
  emergency?: boolean;
}

export default function ActiveCallCard({
  call,
  onOpen,
  agentPath,
  urgency = "low",
  symptoms = [],
  action = "Listening...",
  emergency = false,
}: Props) {
  const timer = useLiveTimer(call.startedAt);
  const isEmergency = emergency || call.agent === "emergency";
  const displayName = call.patientName || "Unknown caller";
  const path = agentPath ?? [call.agent];

  return (
    <div
      className={`active-call-card ${isEmergency ? "emergency" : ""}`}
      onClick={() => onOpen(call)}
    >
      <div className="acc-head">
        <div className="acc-head-left">
          <LiveBadge emergency={isEmergency} label={isEmergency ? "EMERGENCY" : "LIVE"} />
          <span className="acc-timer mono">{timer}</span>
          <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>·</span>
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {call.callSid}
          </span>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(call);
          }}
        >
          Open <Icon name="arrow-up-right" size={12} />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 2,
        }}
      >
        <div>
          <div className="acc-phone">{maskPhone(call.patientPhone)}</div>
          <div className="acc-name">{displayName}</div>
        </div>
      </div>

      <div className="acc-meta-row">
        <AgentPill agent={call.agent} />
        <span className="acc-action">{action}</span>
      </div>

      <AudioWaveform active intensity={isEmergency ? 1.4 : 0.8} emergency={isEmergency} bars={46} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <AgentJourney path={path} current={call.agent} emergency={isEmergency} />
        <UrgencyBar level={urgency} />
      </div>

      {symptoms.length > 0 && (
        <div className="acc-footer">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="overline">Detected</span>
            {symptoms.map((s, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  padding: "3px 8px",
                  borderRadius: "var(--radius-full)",
                  color: "var(--text-primary)",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
