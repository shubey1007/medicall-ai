// dashboard/src/components/Layout/MainLayout.tsx
import { Outlet } from "react-router-dom";
import { useSocket } from "@/hooks/useSocket";
import Sidebar from "./Sidebar";
import Header from "./Header";

export default function MainLayout() {
  useSocket();

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
