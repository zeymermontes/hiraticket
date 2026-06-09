"use client";
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export type ToastKind = "info" | "success" | "warn" | "mention";
export interface ToastInput { title?: string; message: string; kind?: ToastKind; href?: string }
interface Toast extends ToastInput { id: number }

const ToastCtx = createContext<{ push: (t: ToastInput) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

const ICON: Record<ToastKind, string> = { info: "bell", success: "check", warn: "clock", mention: "at" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const remove = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
    setTimeout(() => remove(id), 6000);
  }, [remove]);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toaster">
        {toasts.map((t) => <ToastCard key={t.id} t={t} onClose={() => remove(t.id)} />)}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const router = useRouter();
  const kind = t.kind ?? "info";
  const go = () => { if (t.href) { router.push(t.href); onClose(); } };
  return (
    <div className={"toast toast-" + kind + (t.href ? " toast-click" : "")} onClick={t.href ? go : undefined} role={t.href ? "button" : undefined}>
      <span className="toast-ic"><Icon name={ICON[kind]} size={16} /></span>
      <div className="toast-body">
        {t.title && <div className="toast-title">{t.title}</div>}
        <div className="toast-msg">{t.message}</div>
      </div>
      <button className="iconbtn sm" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="close"><Icon name="x" size={13} /></button>
    </div>
  );
}
