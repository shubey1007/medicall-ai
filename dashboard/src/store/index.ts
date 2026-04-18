// dashboard/src/store/index.ts
import { configureStore } from "@reduxjs/toolkit";
import callReducer from "./callSlice";
import patientReducer from "./patientSlice";
import analyticsReducer from "./analyticsSlice";
import uiReducer from "./uiSlice";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";

export const store = configureStore({
  reducer: {
    calls: callReducer,
    patients: patientReducer,
    analytics: analyticsReducer,
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
