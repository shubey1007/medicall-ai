import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "@/lib/api";

interface UrgencyBreakdown {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

interface CallsPerDay {
  date: string;
  count: number;
}

export interface AnalyticsSummary {
  total_calls: number;
  active_calls: number;
  completed_calls: number;
  average_duration_seconds: number;
  urgency_breakdown: UrgencyBreakdown;
  calls_per_day: CallsPerDay[];
}

export interface AgentStat {
  agent_name: string;
  message_count: number;
}

interface AnalyticsState {
  summary: AnalyticsSummary | null;
  agents: AgentStat[];
  loading: boolean;
  error: string | null;
}

const initialState: AnalyticsState = {
  summary: null,
  agents: [],
  loading: false,
  error: null,
};

export const fetchAnalyticsSummary = createAsyncThunk("analytics/fetchSummary", async () => {
  const response = await api.get<AnalyticsSummary>("/api/analytics/summary");
  return response.data;
});

export const fetchAgentStats = createAsyncThunk("analytics/fetchAgents", async () => {
  const response = await api.get<{ agents: AgentStat[] }>("/api/analytics/agents");
  return response.data.agents;
});

const analyticsSlice = createSlice({
  name: "analytics",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAnalyticsSummary.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAnalyticsSummary.fulfilled, (state, action) => {
        state.loading = false;
        state.summary = action.payload;
      })
      .addCase(fetchAnalyticsSummary.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to fetch analytics";
      })
      .addCase(fetchAgentStats.fulfilled, (state, action) => {
        state.agents = action.payload;
      });
  },
});

export default analyticsSlice.reducer;
