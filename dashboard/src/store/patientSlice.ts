import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "@/lib/api";
import type { PaginatedResponse, Patient } from "@/types";

interface PatientState {
  items: Patient[];
  total: number;
  loading: boolean;
  error: string | null;
}

const initialState: PatientState = {
  items: [],
  total: 0,
  loading: false,
  error: null,
};

export const fetchPatients = createAsyncThunk(
  "patients/fetch",
  async (params: { search?: string; page?: number; page_size?: number } = {}) => {
    const response = await api.get<PaginatedResponse<Patient>>("/api/patients", { params });
    return response.data;
  }
);

const patientSlice = createSlice({
  name: "patients",
  initialState,
  reducers: {
    clearPatients(state) {
      state.items = [];
      state.total = 0;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPatients.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPatients.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.items;
        state.total = action.payload.total;
      })
      .addCase(fetchPatients.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to fetch patients";
      });
  },
});

export const { clearPatients } = patientSlice.actions;
export default patientSlice.reducer;
