// dashboard/src/pages/DemoCall.tsx
import { useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import Icon from "@/components/primitives/Icon";
import LiveBadge from "@/components/primitives/LiveBadge";

const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY ?? "";

const SYSTEM_PROMPT = `You are MediCall AI, a friendly medical assistant for demo purposes.
Always respond in English. Help with: symptoms, medications, appointment questions.
This is a live demo — be engaging and show off your capabilities!
Critical safety rule: Always recommend consulting a doctor for personal medical advice.`;

const ASSISTANT_CONFIG = {
  name: "MediCall AI Demo",
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
  },
  voice: { provider: "11labs", voiceId: "burt" },
  transcriber: { provider: "deepgram", model: "nova-2", language: "en-US" },
  firstMessage:
    "Hello! I'm MediCall AI. I can answer medical questions, help with medications, or assist with appointments. How can I help you today?",
};

type CallStatus = "idle" | "connecting" | "active" | "ended";

interface TranscriptEntry {
  role: string;
  text: string;
}

export default function DemoCall() {
  const vapiRef = useRef<InstanceType<typeof Vapi> | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [volume, setVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) {
      console.warn("VITE_VAPI_PUBLIC_KEY is not set — Vapi will not initialize");
      return;
    }
    const vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setStatus("active");
      setErrorMsg("");
    });
    vapi.on("call-end", () => {
      setStatus("ended");
      setVolume(0);
    });
    vapi.on("volume-level", (v: number) => setVolume(v));
    vapi.on(
      "message",
      (msg: {
        type: string;
        role?: string;
        transcript?: string;
        transcriptType?: "partial" | "final";
      }) => {
        if (
          msg.type === "transcript" &&
          msg.transcript &&
          msg.transcriptType === "final"
        ) {
          setTranscript((prev) => [
            ...prev,
            { role: msg.role ?? "unknown", text: msg.transcript! },
          ]);
        }
      },
    );
    vapi.on("error", (e: unknown) => {
      console.error("Vapi error:", e);
      const errorObj = e as { error?: { errorMsg?: string; msg?: string }; errorMsg?: string };
      const msg =
        errorObj?.error?.errorMsg ??
        errorObj?.error?.msg ??
        errorObj?.errorMsg ??
        "Call failed. Check console and Vapi dashboard for details.";
      setErrorMsg(msg);
      setStatus("idle");
    });

    return () => {
      vapi.stop();
    };
  }, []);

  async function startCall() {
    if (!VAPI_PUBLIC_KEY) {
      setErrorMsg("Vapi public key not configured. Set VITE_VAPI_PUBLIC_KEY in dashboard/.env");
      return;
    }
    setStatus("connecting");
    setTranscript([]);
    setErrorMsg("");
    try {
      await vapiRef.current?.start(
        ASSISTANT_CONFIG as Parameters<InstanceType<typeof Vapi>["start"]>[0],
      );
    } catch (e) {
      console.error("Failed to start Vapi call:", e);
      setErrorMsg(e instanceof Error ? e.message : "Failed to start call");
      setStatus("idle");
    }
  }

  function endCall() {
    vapiRef.current?.stop();
    setStatus("ended");
  }

  const bars = Array.from({ length: 9 }, (_, i) => i);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Demo</h1>
          <div className="page-sub">
            Talk to MediCall AI in the browser — no phone required
          </div>
        </div>
        <div className="page-actions">
          {status === "active" && <LiveBadge label="LIVE" />}
        </div>
      </div>

      <div className="demo-container">
        <div
          className="card"
          style={{
            padding: 36,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            background:
              "radial-gradient(ellipse at top, rgba(0,229,208,0.08), transparent 60%), var(--bg-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 56 }}>
            {bars.map((i) => {
              const offset = Math.abs(i - 4) * 0.15;
              const active = status === "active";
              const h = Math.max(8, (active ? volume : 0.1) * 56 * (1 - offset) + 8);
              return (
                <div
                  key={i}
                  style={{
                    width: 4,
                    background: active ? "var(--brand-400)" : "var(--bg-elevated)",
                    borderRadius: 2,
                    height: `${h}px`,
                    transition: "height 80ms ease-out",
                    boxShadow: active ? "0 0 8px rgba(0,229,208,0.5)" : "none",
                  }}
                />
              );
            })}
          </div>

          <div style={{ textAlign: "center" }}>
            {status === "idle" && (
              <div style={{ color: "var(--text-secondary)" }}>
                Click to start a demo call
              </div>
            )}
            {status === "connecting" && (
              <div style={{ color: "var(--brand-400)" }}>Connecting…</div>
            )}
            {status === "active" && (
              <div style={{ color: "var(--success)", fontWeight: 600 }}>Live · speak now</div>
            )}
            {status === "ended" && (
              <div style={{ color: "var(--text-secondary)" }}>Call ended</div>
            )}
          </div>

          {(status === "idle" || status === "ended") && (
            <button
              onClick={startCall}
              className="btn btn-primary"
              style={{ height: 44, padding: "0 28px" }}
            >
              <Icon name="phone" size={16} />{" "}
              {status === "ended" ? "Start new call" : "Start demo call"}
            </button>
          )}
          {status === "active" && (
            <button
              onClick={endCall}
              className="btn btn-danger"
              style={{ height: 44, padding: "0 28px" }}
            >
              <Icon name="phone-off" size={16} /> End call
            </button>
          )}

          {errorMsg && (
            <div
              style={{
                padding: 12,
                background: "var(--danger-subtle)",
                border: "1px solid rgba(248,113,113,0.3)",
                borderRadius: "var(--radius-md)",
                color: "var(--danger)",
                fontSize: "var(--text-sm)",
                width: "100%",
              }}
            >
              <strong>Error:</strong> {errorMsg}
            </div>
          )}
        </div>

        {transcript.length > 0 && (
          <div className="card" style={{ padding: 16, maxHeight: 340, overflow: "auto" }}>
            <div className="overline" style={{ marginBottom: 10 }}>
              Live transcript
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {transcript.map((t, i) => {
                const isAi = t.role === "assistant";
                return (
                  <div
                    key={i}
                    className={`bubble-col ${isAi ? "agent" : "patient"}`}
                    style={{
                      alignSelf: isAi ? "flex-start" : "flex-end",
                    }}
                  >
                    <div
                      className={`bubble ${isAi ? "bubble-agent" : "bubble-patient"}`}
                    >
                      {t.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {[
            { icon: "languages", title: "Multilingual", desc: "Hindi & English auto-detect" },
            { icon: "brain", title: "Memory", desc: "Recalls past visits via Qdrant" },
            { icon: "zap", title: "Real-time", desc: "Live voice with Vapi" },
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
