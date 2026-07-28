"use client";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export type ToastKind = "info" | "success" | "warn" | "mention";
export interface ToastInput {
  title?: string; message: string; kind?: ToastKind; href?: string;
  /** No se cierra solo: espera clic o la X. Las menciones lo usan por defecto — perderse que te
   *  nombraron por mirar a otro lado seis segundos es justo lo que hay que evitar. */
  sticky?: boolean;
}
interface Toast extends ToastInput { id: number }

const AUTO_DISMISS_MS = 6000;
/** Tope de la pila. Alto porque la columna scrollea; solo evita crecer sin límite. */
const MAX_TOASTS = 20;

const ToastCtx = createContext<{ push: (t: ToastInput) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

/** Toast "flujo activado" for each automation that fired. Pass the `flows` array a server action returns. */
export function useFlowToast() {
  const { push } = useToast();
  return useCallback((flows: string[] | undefined, lang: "es" | "en" = "es") => {
    for (const f of flows ?? []) push({ kind: "success", title: lang === "es" ? "Flujo activado" : "Flow triggered", message: f, href: "/flows" });
  }, [push]);
}

const ICON: Record<ToastKind, string> = { info: "bell", success: "check", warn: "clock", mention: "at" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const remove = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    const sticky = t.sticky ?? t.kind === "mention";
    setToasts((ts) => [...ts.slice(-(MAX_TOASTS - 1)), { ...t, id, sticky }]);
    if (!sticky) setTimeout(() => remove(id), AUTO_DISMISS_MS);
  }, [remove]);

  // El más nuevo va abajo, pegado a la esquina. Al desbordar los 50vh el scroll se queda arriba
  // mostrando los viejos, así que lo bajamos al llegar uno nuevo.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [toasts.length]);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toaster" ref={boxRef}>
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
