// dashboard/src/components/TranscriptPanel.tsx
import { useEffect, useRef } from "react";
import type { ActiveCall } from "@/types";
import Icon from "@/components/primitives/Icon";
import LiveBadge from "@/components/primitives/LiveBadge";
import AgentPill, { AGENTS } from "@/components/primitives/AgentPill";
import UrgencyBar from "@/components/primitives/UrgencyBar";
import { useLiveTimer } from "@/components/primitives/hooks";
import { maskPhone, initialsFrom } from "@/lib/format";

interface Props {
  call: ActiveCall;
  onClose: () => void;
  urgency?: string;
  symptoms?: string[];
}

export default function TranscriptPanel({
  call,
  onClose,
  urgency = "low",
  symptoms = [],
}: Props) {
  const timer = useLiveTimer(call.startedAt);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [call.transcript.length]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const currentAgent = AGENTS[call.agent] ?? null;

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="panel">
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button className="icon-btn" onClick={onClose}>
            <Icon name="chevron-left" size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Live Transcript</div>
              <LiveBadge emergency={call.agent === "emergency"} label="REC" />
            </div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                marginTop: 2,
              }}
            >
              {call.callSid} · {timer}
            </div>
          </div>
        </div>

        {/* Patient strip */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--bg-elevated)",
          }}
        >
          <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
            {initialsFrom(call.patientName, "??")}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
              {call.patientName ?? "Unknown"}
            </div>
            <div
              className="mono"
              style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}
            >
              {maskPhone(call.patientPhone)}
            </div>
          </div>
          <AgentPill agent={call.agent} />
        </div>

        {/* Transcript body */}
        <div className="transcript-body" ref={bodyRef}>
          {call.transcript.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
                gap: 10,
              }}
            >
              <Icon name="mic" size={24} />
              Waiting for conversation...
            </div>
          )}
          {call.transcript.map((m, i) => {
            if (m.role === "system") {
              return (
                <div key={m.id || i} className="bubble-row system">
                  <div className="switch-divider" style={{ minWidth: 280 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Icon name="shuffle" size={11} />
                      {m.content}
                    </span>
                  </div>
                </div>
              );
            }
            const isAgent = m.role === "agent";
            const agentName = m.agent_name ?? "triage";
            const agentInfo = AGENTS[agentName.toLowerCase()];
            return (
              <div
                key={m.id || i}
                className={`bubble-col ${isAgent ? "agent" : "patient"}`}
                style={{
                  alignSelf: isAgent ? "flex-start" : "flex-end",
                  animation: "bubble-in 0.3s var(--ease-out) both",
                  animationDelay: `${i * 40}ms`,
                  marginBottom: 12,
                }}
              >
                {isAgent && agentInfo && (
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "var(--tracking-wide)",
                      textTransform: "uppercase",
                      color: agentInfo.color,
                      marginBottom: 4,
                      paddingLeft: 4,
                    }}
                  >
                    {agentInfo.name} Agent
                  </div>
                )}
                <div className={`bubble ${isAgent ? "bubble-agent" : "bubble-patient"}`}>
                  {m.content}
                </div>
                <div className="bubble-stamp">{m.timestamp?.slice(11, 19)}</div>
              </div>
            );
          })}
          {call.transcript.length > 0 && (
            <div className="bubble-col agent" style={{ alignSelf: "flex-start" }}>
              {currentAgent && (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "var(--tracking-wide)",
                    textTransform: "uppercase",
                    color: currentAgent.color,
                    marginBottom: 4,
                    paddingLeft: 4,
                  }}
                >
                  {currentAgent.name} Agent
                </div>
              )}
              <div className="typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        {/* Footer meta */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
          }}
        >
          {symptoms.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="overline" style={{ marginBottom: 6 }}>
                Symptoms
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {symptoms.map((s, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      background: "var(--bg-elevated)",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-full)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="overline">Urgency</span>
            <UrgencyBar level={urgency} />
          </div>
        </div>
      </div>
    </>
  );
}
