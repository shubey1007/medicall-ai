// dashboard/src/components/Layout/Header.tsx
import { useAppSelector } from "@/store";

export default function Header() {
  const activeCount = useAppSelector((s) => Object.keys(s.calls.activeCalls).length);

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
      <div className="text-sm text-slate-600">
        Real-time monitoring active
      </div>
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${activeCount > 0 ? "bg-green-500 animate-pulse" : "bg-slate-400"}`} />
        <span className="text-sm font-medium">{activeCount} active call{activeCount === 1 ? "" : "s"}</span>
      </div>
    </header>
  );
}
