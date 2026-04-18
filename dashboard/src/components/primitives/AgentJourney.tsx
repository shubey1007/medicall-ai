import { Fragment } from "react";
import Icon from "./Icon";
import { AGENTS } from "./AgentPill";

interface AgentJourneyProps {
  path: string[];
  current?: string | null;
  emergency?: boolean;
}

export default function AgentJourney({ path, current, emergency }: AgentJourneyProps) {
  if (!path || path.length === 0) return null;
  return (
    <div className="journey">
      {path.map((s, i) => {
        const key = s.toLowerCase();
        const agent = AGENTS[key];
        return (
          <Fragment key={`${s}-${i}`}>
            {i > 0 && (
              <span className="arrow">
                <Icon name="chevron-right" size={12} strokeWidth={2.4} />
              </span>
            )}
            <span
              className={`step ${key === (current ?? "").toLowerCase() ? "current" : ""}`}
              style={{
                color: agent?.color ?? "var(--text-secondary)",
                borderColor: agent?.color ?? "var(--border-default)",
                background: agent?.subtle ?? "var(--bg-elevated)",
              }}
            >
              {agent?.short ?? s}
            </span>
          </Fragment>
        );
      })}
      {!emergency && (
        <>
          <span className="arrow">
            <Icon name="chevron-right" size={12} strokeWidth={2.4} />
          </span>
          <span className="step pending">?</span>
        </>
      )}
    </div>
  );
}
