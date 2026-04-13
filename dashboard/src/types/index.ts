// dashboard/src/types/index.ts
export type CallStatus = "ringing" | "active" | "completed" | "failed";
export type UrgencyLevel = "low" | "medium" | "high" | "critical";
export type TranscriptRole = "patient" | "agent" | "system";

export interface Patient {
  id: string;
  phone: string;
  name: string | null;
  medical_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  content: string;
  agent_name: string | null;
  timestamp: string;
}

export interface CallSummary {
  id: string;
  summary_text: string;
  extracted_symptoms: string[];
  urgency_level: UrgencyLevel;
  recommended_actions: string[];
  created_at: string;
}

export interface Call {
  id: string;
  call_sid: string;
  patient_id: string;
  status: CallStatus;
  current_agent: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  patient_name: string | null;
  urgency_level: UrgencyLevel | null;
}

export interface Doctor {
  id: string;
  name: string;
  specialization: string;
  phone: string | null;
  email: string | null;
  available_days: string[];
  available_hours: string;
  bio: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CallDetail extends Call {
  transcript_entries: TranscriptEntry[];
  summary: CallSummary | null;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_name: string;
  scheduled_at: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  notes: string | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ActiveCall {
  callSid: string;
  patientPhone: string;
  patientName: string | null;
  agent: string;
  startedAt: string;
  transcript: TranscriptEntry[];
}

// Socket.IO events
export interface CallStartedEvent {
  callSid: string;
  patientPhone: string;
  patientName: string | null;
  agent: string;
  startedAt: string;
}

export interface CallEndedEvent {
  callSid: string;
  duration: number;
}

export interface AgentChangedEvent {
  callSid: string;
  fromAgent: string;
  toAgent: string;
}

export interface TranscriptEvent {
  callSid: string;
  role: TranscriptRole;
  content: string;
  agentName?: string;
}
