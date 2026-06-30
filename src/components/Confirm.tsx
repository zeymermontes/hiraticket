"use client";
import React, { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "@/components/Icon";

export interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;   // red confirm button
  icon?: string;      // icon name shown next to the title
}

const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
/** Custom (non-native) confirm. `const confirm = useConfirm(); if (await confirm({...})) {...}` */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);
  const close = (v: boolean) => { setState((s) => { s?.resolve(v); return null; }); };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-wrap" style={{ zIndex: 1200 }}>
          <div className="scrim" onClick={() => close(false)} />
          <div className="modal" style={{ width: 400, maxWidth: "92vw" }} role="alertdialog" aria-modal="true">
            <div className="modal-head">
              {state.opts.icon && <span className="t-ic" style={{ color: state.opts.danger ? "var(--red)" : "var(--brand-700)" }}><Icon name={state.opts.icon} size={18} /></span>}
              <h3 className="grow">{state.opts.title ?? "Confirmar"}</h3>
              <button className="iconbtn" onClick={() => close(false)} aria-label="close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{state.opts.message}</p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-outline grow" onClick={() => close(false)} autoFocus>{state.opts.cancelLabel ?? "Cancelar"}</button>
              <button className={"btn grow " + (state.opts.danger ? "btn-danger" : "btn-primary")} onClick={() => close(true)}>{state.opts.confirmLabel ?? "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
