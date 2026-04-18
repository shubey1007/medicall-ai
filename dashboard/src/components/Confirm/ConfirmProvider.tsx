// dashboard/src/components/Confirm/ConfirmProvider.tsx
// App-wide confirmation modal, replacing window.confirm() everywhere.
// Usage:
//   const confirm = useConfirm();
//   if (await confirm({ title: "Delete?", body: "Cannot be undone.", danger: true })) { ... }
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import Icon from "@/components/primitives/Icon";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling on the confirm button + alert-triangle icon. */
  danger?: boolean;
  /** Non-destructive intent: uses the info palette instead of brand. */
  tone?: "default" | "danger" | "info";
}

type Resolver = (ok: boolean) => void;

interface PendingState {
  opts: ConfirmOptions;
  resolve: Resolver;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false),
);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  function close(result: boolean) {
    const p = pendingRef.current;
    if (!p) return;
    setPending(null);
    p.resolve(result);
  }

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmModal
          opts={pending.opts}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  return useContext(ConfirmContext);
}

function ConfirmModal({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tone: "default" | "danger" | "info" = opts.tone ?? (opts.danger ? "danger" : "default");
  const icon =
    tone === "danger" ? "alert-triangle" : tone === "info" ? "info" : "circle-help";
  const iconColor =
    tone === "danger"
      ? "var(--danger)"
      : tone === "info"
        ? "var(--info)"
        : "var(--brand-400)";
  const iconBg =
    tone === "danger"
      ? "var(--danger-subtle)"
      : tone === "info"
        ? "var(--info-subtle)"
        : "var(--brand-subtle)";

  const confirmClass = tone === "danger" ? "btn btn-danger" : "btn btn-primary";

  return (
    <div
      className="modal-backdrop"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="modal"
        style={{ width: 440, padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "20px 22px", display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: iconBg,
              color: iconColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name={icon} size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              id="confirm-title"
              style={{
                fontSize: "var(--text-md)",
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 6,
              }}
            >
              {opts.title}
            </div>
            {opts.body && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.55,
                }}
              >
                {opts.body}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            padding: "12px 22px 18px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <button className="btn btn-secondary" onClick={onCancel}>
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button className={confirmClass} onClick={onConfirm} autoFocus>
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
