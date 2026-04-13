// dashboard/src/store/callSlice.ts
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type {
  ActiveCall,
  Call,
  CallStartedEvent,
  CallEndedEvent,
  AgentChangedEvent,
  TranscriptEvent,
} from "@/types";

interface CallState {
  activeCalls: Record<string, ActiveCall>;
  recentHistory: Call[];
}

const initialState: CallState = {
  activeCalls: {},
  recentHistory: [],
};

const callSlice = createSlice({
  name: "calls",
  initialState,
  reducers: {
    callStarted(state, action: PayloadAction<CallStartedEvent>) {
      const { callSid, patientPhone, agent, startedAt } = action.payload;
      state.activeCalls[callSid] = {
        callSid,
        patientPhone,
        agent,
        startedAt,
        transcript: [],
      };
    },
    callEnded(state, action: PayloadAction<CallEndedEvent>) {
      delete state.activeCalls[action.payload.callSid];
    },
    agentChanged(state, action: PayloadAction<AgentChangedEvent>) {
      const call = state.activeCalls[action.payload.callSid];
      if (call) call.agent = action.payload.toAgent;
    },
    transcriptReceived(state, action: PayloadAction<TranscriptEvent>) {
      const { callSid, role, content, agentName } = action.payload;
      const call = state.activeCalls[callSid];
      if (!call) return;
      call.transcript.push({
        id: `${callSid}-${call.transcript.length}`,
        role,
        content,
        agent_name: agentName ?? null,
        timestamp: new Date().toISOString(),
      });
    },
    setRecentHistory(state, action: PayloadAction<Call[]>) {
      state.recentHistory = action.payload;
    },
  },
});

export const {
  callStarted,
  callEnded,
  agentChanged,
  transcriptReceived,
  setRecentHistory,
} = callSlice.actions;

export default callSlice.reducer;
