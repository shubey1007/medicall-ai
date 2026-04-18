import { useEffect, useState } from "react";

export function useLiveTimer(startedAt: string | null | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [startedAt]);
  if (!startedAt) return "0:00";
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function useCountUp(target: number | string, duration = 900): number | string {
  const [v, setV] = useState<number | string>(target);
  useEffect(() => {
    if (typeof target !== "number") {
      setV(target);
      return;
    }
    const steps = 30;
    let i = 0;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    setV(0);
    const tick = setInterval(() => {
      i++;
      const p = Math.min(1, i / steps);
      setV(Math.round(easeOut(p) * target));
      if (p >= 1) clearInterval(tick);
    }, Math.max(16, duration / steps));
    return () => clearInterval(tick);
  }, [target, duration]);
  return v;
}
