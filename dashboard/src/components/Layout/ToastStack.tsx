import { useEffect } from "react";
import Icon from "@/components/primitives/Icon";
import { useAppDispatch, useAppSelector } from "@/store";
import { dismissToast, Toast } from "@/store/uiSlice";

const ICON_FOR: Record<string, string> = {
  success: "check-circle-2",
  danger: "alert-triangle",
  info: "info",
};

const COLOR_FOR: Record<string, string> = {
  success: "var(--success)",
  danger: "var(--danger)",
  info: "var(--info)",
};

function ToastRow({ t, onDismiss }: { t: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const id = t.id;
    const timer = setTimeout(() => onDismiss(id), 5000);
    return () => clearTimeout(timer);
  }, [t.id, onDismiss]);

  return (
    <div className={`toast ${t.kind}`}>
      <Icon
        name={ICON_FOR[t.kind]}
        size={16}
        style={{ color: COLOR_FOR[t.kind], flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
          {t.title}
        </div>
        {t.body && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>
            {t.body}
          </div>
        )}
      </div>
      <button
        className="icon-btn"
        style={{ width: 22, height: 22 }}
        onClick={() => onDismiss(t.id)}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

export default function ToastStack() {
  const dispatch = useAppDispatch();
  const toasts = useAppSelector((s) => s.ui.toasts);

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastRow key={t.id} t={t} onDismiss={(id) => dispatch(dismissToast(id))} />
      ))}
    </div>
  );
}
