// dashboard/src/pages/DemoCall.tsx
import { useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";

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
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
    ],
  },
  voice: {
    provider: "11labs",
    voiceId: "burt",
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "en-US",
  },
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
  const [errorMsg, setErrorMsg] = useState<string>("");

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
      }
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
        ASSISTANT_CONFIG as Parameters<InstanceType<typeof Vapi>["start"]>[0]
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

  const bars = Array.from({ length: 5 }, (_, i) => i);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">MediCall AI — Live Demo</h1>
        <p className="text-slate-500 text-sm">
          Powered by Vapi + Qdrant · Multilingual · No phone required
        </p>
      </div>

      {/* Call widget */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col items-center gap-6">
        {/* Volume visualizer */}
        <div className="flex items-end gap-1 h-12">
          {bars.map((i) => (
            <div
              key={i}
              className="w-2 rounded bg-blue-500 transition-all duration-75"
              style={{
                height: `${Math.max(8, volume * 48)}px`,
              }}
            />
          ))}
        </div>

        <div className="text-center">
          {status === "idle" && (
            <p className="text-slate-500">Click to start a demo call</p>
          )}
          {status === "connecting" && (
            <p className="text-blue-600 animate-pulse">Connecting...</p>
          )}
          {status === "active" && (
            <p className="text-green-600 font-medium">● Live — speak now</p>
          )}
          {status === "ended" && (
            <p className="text-slate-500">Call ended</p>
          )}
        </div>

        {(status === "idle" || status === "ended") && (
          <button
            onClick={startCall}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full text-lg shadow"
          >
            {status === "ended" ? "Start New Call" : "Start Demo Call"}
          </button>
        )}

        {status === "active" && (
          <button
            onClick={endCall}
            className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-full text-lg shadow"
          >
            End Call
          </button>
        )}

        {errorMsg && (
          <div className="w-full bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}
      </div>

      {/* Live transcript */}
      {transcript.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 max-h-80 overflow-y-auto">
          <div className="text-xs uppercase text-slate-400 font-semibold">
            Live Transcript
          </div>
          {transcript.map((t, i) => (
            <div
              key={i}
              className={`text-sm ${
                t.role === "assistant" ? "text-blue-700" : "text-slate-700"
              }`}
            >
              <span className="font-medium">
                {t.role === "assistant" ? "AI" : "You"}:{" "}
              </span>
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* Feature callouts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: "🌐", title: "Multilingual", desc: "Hindi & English auto-detect" },
          { icon: "🧠", title: "Memory", desc: "Recalls past visits via Qdrant" },
          { icon: "⚡", title: "Real-time", desc: "Live voice with Vapi" },
        ].map((f) => (
          <div
            key={f.title}
            className="bg-white rounded-lg border border-slate-200 p-4 text-center"
          >
            <div className="text-2xl mb-1">{f.icon}</div>
            <div className="font-semibold text-sm text-slate-800">{f.title}</div>
            <div className="text-xs text-slate-500">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
