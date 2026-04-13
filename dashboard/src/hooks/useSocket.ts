// dashboard/src/hooks/useSocket.ts
import { useEffect } from "react";
import { useAppDispatch } from "@/store";
import {
  agentChanged,
  callEnded,
  callStarted,
  transcriptReceived,
} from "@/store/callSlice";
import { connectSocket, dashboardSocket, disconnectSocket } from "@/lib/socket";
import type {
  AgentChangedEvent,
  CallEndedEvent,
  CallStartedEvent,
  TranscriptEvent,
} from "@/types";

export function useSocket(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const onStart = (data: CallStartedEvent) => dispatch(callStarted(data));
    const onEnd = (data: CallEndedEvent) => dispatch(callEnded(data));
    const onAgent = (data: AgentChangedEvent) => dispatch(agentChanged(data));
    const onTranscript = (data: TranscriptEvent) => dispatch(transcriptReceived(data));

    dashboardSocket.on("call:started", onStart);
    dashboardSocket.on("call:ended", onEnd);
    dashboardSocket.on("call:agent_changed", onAgent);
    dashboardSocket.on("call:transcript", onTranscript);

    connectSocket();

    return () => {
      dashboardSocket.off("call:started", onStart);
      dashboardSocket.off("call:ended", onEnd);
      dashboardSocket.off("call:agent_changed", onAgent);
      dashboardSocket.off("call:transcript", onTranscript);
      disconnectSocket();
    };
  }, [dispatch]);
}
