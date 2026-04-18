// dashboard/src/pages/DemoCall.tsx
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/primitives/Icon";
import LiveBadge from "@/components/primitives/LiveBadge";
import { api } from "@/lib/api";
import { dashboardSocket, connectSocket } from "@/lib/socket";

const DEFAULT_PHONE = "+91";

type CallStatus = "idle" | "calling" | "active" | "ended" | "error";

interface TranscriptLine {
  role: string;
  text: string;
}

export default function DemoCall() {
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [callSid, setCallSid] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Keep socket connected while on this page
  useEffect(() => {
    connectSocket();
  }, []);

  // Socket.IO listeners scoped to our call SID
  useEffect(() => {
    if (!callSid) return;

    function onStarted(data: { callSid: string }) {
      if (data.callSid === callSid) {
        setStatus("active");
        setDuration(0);
        timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      }
    }

    function onTranscript(data: { callSid: string; role: string; content: string }) {
      if (data.callSid !== callSid) return;
      setTranscript((prev) => [...prev, { role: data.role, text: data.content }]);
    }

    function onEnded(data: { callSid: string }) {
      if (data.callSid !== callSid) return;
      setStatus("ended");
      if (timerRef.current) clearInterval(timerRef.current);
    }

    dashboardSocket.on("call:started", onStarted);
    dashboardSocket.on("call:transcript", onTranscript);
    dashboardSocket.on("call:ended", onEnded);

    return () => {
      dashboardSocket.off("call:started", onStarted);
      dashboardSocket.off("call:transcript", onTranscript);
      dashboardSocket.off("call:ended", onEnded);
    };
  }, [callSid]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function startCall() {
    if (!phone.trim()) {
      setErrorMsg("Enter a phone number first.");
      return;
    }
    setErrorMsg("");
    setTranscript([]);
    setCallSid(null);
    setDuration(0);
    setStatus("calling");

    try {
      const res = await api.post("/api/calls/initiate", { to_phone: phone.trim() });
      setCallSid(res.data.call_sid);
      // status will flip to "active" when call:started arrives via socket
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to start call. Check Twilio settings.";
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  function reset() {
    setStatus("idle");
    setTranscript([]);
    setCallSid(null);
    setErrorMsg("");
    setDuration(0);
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  const isLive = status === "active";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Demo</h1>
          <div className="page-sub">
            Place an outbound AI call to any phone number
          </div>
        </div>
        <div className="page-actions">
          {isLive && <LiveBadge label="LIVE" />}
        </div>
      </div>

      <div className="demo-container">
        {/* ── Main call card ── */}
        <div
          className="card"
          style={{
            padding: 36,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 28,
            background:
              "radial-gradient(ellipse at top, rgba(0,229,208,0.08), transparent 60%), var(--bg-surface)",
          }}
        >
          {/* Animated avatar */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: isLive
                ? "radial-gradient(circle, rgba(0,229,208,0.3), rgba(0,229,208,0.05))"
                : "var(--bg-elevated)",
              border: `2px solid ${isLive ? "var(--brand-400)" : "var(--border)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: isLive ? "0 0 24px rgba(0,229,208,0.35)" : "none",
              transition: "all 0.4s ease",
            }}
          >
            <Icon
              name={status === "calling" ? "loader" : isLive ? "mic" : "phone"}
              size={32}
              style={{
                color: isLive ? "var(--brand-400)" : "var(--text-secondary)",
                animation: status === "calling" ? "spin 1s linear infinite" : undefined,
              }}
            />
          </div>

          {/* Status text */}
          <div style={{ textAlign: "center" }}>
            {status === "idle" && (
              <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                Enter a phone number and start the demo
              </div>
            )}
            {status === "calling" && (
              <div style={{ color: "var(--brand-400)", fontWeight: 600 }}>
                Calling… waiting for pickup
              </div>
            )}
            {isLive && (
              <div style={{ color: "var(--success)", fontWeight: 700, fontSize: 18 }}>
                Connected · {fmt(duration)}
              </div>
            )}
            {status === "ended" && (
              <div style={{ color: "var(--text-secondary)" }}>
                Call ended · {fmt(duration)}
              </div>
            )}
            {status === "error" && (
              <div style={{ color: "var(--danger)", fontWeight: 600 }}>Call failed</div>
            )}
          </div>

          {/* Phone input */}
          {(status === "idle" || status === "error") && (
            <div style={{ width: "100%", maxWidth: 320 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Phone number (with country code)
              </label>
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                style={{ width: "100%", textAlign: "center", fontSize: 18, letterSpacing: 2 }}
                onKeyDown={(e) => e.key === "Enter" && startCall()}
              />
            </div>
          )}

          {/* Action buttons */}
          {(status === "idle" || status === "error") && (
            <button
              onClick={startCall}
              className="btn btn-primary"
              style={{ height: 48, padding: "0 36px", fontSize: 16, gap: 10 }}
            >
              <Icon name="phone-call" size={18} /> Start Demo Call
            </button>
          )}

          {status === "calling" && (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
              MediCall AI will answer when the phone is picked up
            </div>
          )}

          {(status === "ended" || status === "error") && (
            <button onClick={reset} className="btn btn-secondary" style={{ height: 44, padding: "0 28px" }}>
              <Icon name="refresh-cw" size={16} /> Try again
            </button>
          )}

          {errorMsg && (
            <div
              style={{
                padding: "10px 16px",
                background: "var(--danger-subtle)",
                border: "1px solid rgba(248,113,113,0.3)",
                borderRadius: "var(--radius-md)",
                color: "var(--danger)",
                fontSize: "var(--text-sm)",
                width: "100%",
                maxWidth: 380,
                textAlign: "center",
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* ── Live transcript ── */}
        {(status === "active" || status === "ended") && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="message-square" size={14} style={{ color: "var(--brand-400)" }} />
              <span className="overline" style={{ margin: 0 }}>
                Live transcript
              </span>
              {isLive && <LiveBadge label="LIVE" />}
            </div>
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {transcript.length === 0 && (
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", textAlign: "center" }}>
                  Waiting for conversation…
                </div>
              )}
              {transcript.map((t, i) => {
                const isAi = t.role === "assistant";
                return (
                  <div
                    key={i}
                    className={`bubble-col ${isAi ? "agent" : "patient"}`}
                    style={{ alignSelf: isAi ? "flex-start" : "flex-end" }}
                  >
                    <div className={`bubble ${isAi ? "bubble-agent" : "bubble-patient"}`}>
                      {t.text}
                    </div>
                  </div>
                );
              })}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {/* ── Feature highlights ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { icon: "phone-outgoing", title: "Outbound AI Call", desc: "AI calls the patient's real phone number" },
            { icon: "brain", title: "Patient Memory", desc: "Recalls past visits via Qdrant vector DB" },
            { icon: "git-branch", title: "Multi-agent", desc: "Triage → Scheduling / Medication / Emergency" },
          ].map((f) => (
            <div key={f.title} className="card" style={{ padding: 18, textAlign: "center" }}>
              <div
                style={{
                  display: "inline-flex",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--brand-subtle)",
                  color: "var(--brand-400)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                }}
              >
                <Icon name={f.icon} size={18} />
              </div>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{f.title}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 4 }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
