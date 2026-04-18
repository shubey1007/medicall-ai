import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type Theme = "dark" | "light";
export type ToastKind = "success" | "danger" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
}

interface UIState {
  theme: Theme;
  cmdOpen: boolean;
  toasts: Toast[];
}

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem("medicall_theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    // ignore
  }
  return "dark";
}

const initialState: UIState = {
  theme: loadTheme(),
  cmdOpen: false,
  toasts: [],
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      try {
        localStorage.setItem("medicall_theme", action.payload);
      } catch {
        // ignore
      }
    },
    toggleTheme(state) {
      state.theme = state.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("medicall_theme", state.theme);
      } catch {
        // ignore
      }
    },
    openCmd(state) { state.cmdOpen = true; },
    closeCmd(state) { state.cmdOpen = false; },
    pushToast(state, action: PayloadAction<Toast>) {
      state.toasts.push(action.payload);
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const { setTheme, toggleTheme, openCmd, closeCmd, pushToast, dismissToast } = uiSlice.actions;
export default uiSlice.reducer;
