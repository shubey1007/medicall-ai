// dashboard/src/components/Layout/MainLayout.tsx
import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useSocket } from "@/hooks/useSocket";
import { useAppDispatch, useAppSelector } from "@/store";
import { openCmd } from "@/store/uiSlice";
import Sidebar from "./Sidebar";
import Header from "./Header";
import CommandPalette from "./CommandPalette";
import ToastStack from "./ToastStack";
import { ConfirmProvider } from "@/components/Confirm/ConfirmProvider";

export default function MainLayout() {
  useSocket();
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        dispatch(openCmd());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  return (
    <ConfirmProvider>
      <div className="shell">
        <Sidebar />
        <Header />
        <main className="main">
          <Outlet />
        </main>
        <CommandPalette />
        <ToastStack />
      </div>
    </ConfirmProvider>
  );
}
