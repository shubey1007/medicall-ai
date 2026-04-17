// dashboard/src/lib/api.ts
import axios from "axios";
import { clearToken, getToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach the bearer token (if any) to every outgoing request
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, drop the (presumably expired) token and bounce to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    if (status === 401) {
      clearToken();
      // Avoid infinite redirect loop if we're already on /login
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }
    console.error("API error:", error.response?.data || error.message);
    return Promise.reject(error);
  },
);
