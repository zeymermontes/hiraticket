/* ============================================================
   HIRATICKET — Shared components & context
   ============================================================ */
const { useState, useEffect, useRef, useCallback, useContext, useReducer, useMemo } = React;

/* ---------- App context ---------- */
const HTCtx = React.createContext(null);
const useApp = () => useContext(HTCtx);
const useLang = () => useApp().state.lang;
const useT = () => { const l = useApp().state.lang; return (k) => window.tr(k, l); };

/* ---------- Icons ---------- */
const P = (d, extra) => React.createElement('path', Object.assign({ d, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, extra));
const ICONS = {
  chat:    () => <>{P('M21 11.5a8.4 8.4 0 0 1-12.1 7.5L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5Z')}</>,
  orders:  () => <>{P('M8 4h8a2 2 0 0 1 2 2v13a1 1 0 0 1-1.5.9L15 19l-1.5 1-1.5-1-1.5 1L9 19l-1.5.9A1 1 0 0 1 6 19V6a2 2 0 0 1 2-2Z')}{P('M9.5 9h5M9.5 12.5h5')}</>,
  kanban:  () => <>{P('M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z')}</>,
  agents:  () => <>{P('M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19')}<circle cx="10" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15 5.2a3.2 3.2 0 0 1 0 6')}</>,
  canned:  () => <>{P('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H10l-4 3.5V15H6.5A2.5 2.5 0 0 1 4 12.5Z')}{P('M8.5 8h7M8.5 11h4')}</>,
  settings:() => <><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V19a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 6.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H11a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z')}</>,
  search:  () => <><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('m20 20-3.2-3.2')}</>,
  bell:    () => <>{P('M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5ZM10 19a2 2 0 0 0 4 0')}</>,
  plus:    () => <>{P('M12 5v14M5 12h14')}</>,
  qr:      () => <>{P('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z')}{P('M14 14h2v2h-2zM18 14h2M20 14v6M14 18h2v2M18 18h2')}</>,
  whatsapp:() => <><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.2 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.7"/>{P('M9 7.8c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3c-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.8 4.3 3.8 2.1.8 2.6.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.3-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a5.8 5.8 0 0 1-1.7-1.1 6.5 6.5 0 0 1-1.2-1.5c-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4Z')}</>,
  send:    () => <>{P('M5 12 20 5l-4 15-4-6-7-2Z')}{P('m12 14 4-5')}</>,
  paperclip:()=> <>{P('M20 11.5 12.5 19a4 4 0 0 1-5.7-5.7l7.6-7.6a2.7 2.7 0 0 1 3.8 3.8L10.6 17a1.3 1.3 0 0 1-1.9-1.9l6.7-6.7')}</>,
  smile:   () => <><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M8.5 14a4 4 0 0 0 7 0')}<circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/></>,
  dots:    () => <><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></>,
  swap:    () => <>{P('M7 8h12l-3-3M17 16H5l3 3')}</>,
  tag:     () => <>{P('M4 12.5V6a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.8l-6.5 6.5a2 2 0 0 1-2.8 0l-6-6A2 2 0 0 1 4 12.5Z')}<circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/></>,
  clock:   () => <><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M12 8v4.3l2.8 1.7')}</>,
  check:    () => <>{P('m5 12.5 4.5 4.5L19 7')}</>,
  checks:   () => <>{P('m2.5 12.5 4 4L14 8')}{P('m11 16.5.5.5L22 7')}</>,
  chevd:   () => <>{P('m6 9 6 6 6-6')}</>,
  chevr:   () => <>{P('m9 6 6 6-6 6')}</>,
  filter:  () => <>{P('M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z')}</>,
  x:       () => <>{P('M6 6 18 18M18 6 6 18')}</>,
  phone:   () => <>{P('M6 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 2-2Z')}</>,
  user:    () => <><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M5.5 20a6.5 6.5 0 0 1 13 0')}</>,
  image:   () => <><rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="10" r="1.4" fill="currentColor"/>{P('m5.5 17 4-4 3 2.5L16 12l3 3.5')}</>,
  mic:     () => <><rect x="9.5" y="3" width="5" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M6 11a6 6 0 0 0 12 0M12 17v3')}</>,
  file:    () => <>{P('M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z')}{P('M14 3v5h5')}</>,
  edit:    () => <>{P('M5 19h3l9-9-3-3-9 9v3ZM14.5 6.5l3 3')}</>,
  trash:   () => <>{P('M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12')}</>,
  eye:     () => <>{P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z')}<circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.8"/></>,
  shield:  () => <>{P('M12 3 5 6v5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z')}{P('m9 12 2 2 4-4')}</>,
  sun:     () => <><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4')}</>,
  moon:    () => <>{P('M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z')}</>,
  globe:   () => <><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M3.8 12h16.4M12 3.8c2.2 2.3 2.2 14.1 0 16.4M12 3.8c-2.2 2.3-2.2 14.1 0 16.4')}</>,
  columns: () => <><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M10 5v14M15 5v14')}</>,
  download:() => <>{P('M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5M5 19h14')}</>,
  sliders: () => <>{P('M5 8h9M5 16h4M16 16h3')}<circle cx="17" cy="8" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="16" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8"/></>,
  arrowr:  () => <>{P('M5 12h13m0 0-5-5m5 5-5 5')}</>,
  store:   () => <>{P('M5 9.5 6 5h12l1 4.5M5 9.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M5 9.5a2.2 2.2 0 0 0 4.5 0 2.2 2.2 0 0 0 4.5 0 2.2 2.2 0 0 0 4.5 0')}</>,
  truck:   () => <>{P('M3 6h11v9H3zM14 9h3.5l2.5 3v3h-6')}<circle cx="7" cy="17.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="17" cy="17.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.8"/></>,
  sparkles:() => <>{P('M12 4l1.4 3.6L17 9l-3.6 1.4L12 14l-1.4-3.6L7 9l3.6-1.4ZM18 14l.7 1.8L20.5 16.5l-1.8.7L18 19l-.7-1.8L15.5 16.5l1.8-.7Z')}</>,
  alert:   () => <>{P('M12 3 2.5 19.5h19L12 3ZM12 10v4M12 17h.01')}</>,
  wifi:    () => <>{P('M5 11.5a10 10 0 0 1 14 0M7.8 14.5a6 6 0 0 1 8.4 0M12 18h.01')}</>,
  wifioff: () => <>{P('M2 5l20 14M5 11.5a10 10 0 0 1 4-2.6M19 11.5a10 10 0 0 0-4.5-2.8M7.8 14.5a6 6 0 0 1 3-1.5M12 18h.01')}</>,
  refresh: () => <>{P('M4 12a8 8 0 0 1 13.5-5.8L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.5 5.8L4 16M4 20v-4h4')}</>,
  lock:    () => <><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M8 11V8a4 4 0 0 1 8 0v3')}</>,
  mail:    () => <><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('m4 7 8 6 8-6')}</>,
  pin:     () => <>{P('M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z')}<circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8"/></>,
  calendar:() => <><rect x="4" y="5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M4 9h16M8 3v3M16 3v3')}</>,
  layers:  () => <>{P('m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5')}</>,
  grip:    () => <><circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/></>,
  info:    () => <><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M12 11v5M12 8h.01')}</>,
  play:    () => <>{P('M8 5.5v13l11-6.5-11-6.5Z')}</>,
  at:      () => <><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('M15.2 9v4a2.3 2.3 0 0 0 4.3 1 8.2 8.2 0 1 0-3 4')}</>,
  dot:     () => <><circle cx="12" cy="12" r="4" fill="currentColor"/></>,
  status:  () => <><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8"/>{P('m8.5 12 2.5 2.5 4.5-5')}</>,
  expand:  () => <>{P('M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4')}</>,
  bolt:    () => <>{P('M13 3 5 13h6l-1 8 8-10h-6l1-8Z')}</>,
  history: () => <>{P('M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8M3 4v4h4M12 8v4.3l3 1.7')}</>,
  flag:    () => <>{P('M6 21V4h11l-2 4 2 4H6')}</>,
};
function Icon({ name, size }) {
  const fn = ICONS[name] || ICONS.dot;
  return <svg width={size||20} height={size||20} viewBox="0 0 24 24" style={{ display:'block' }}>{fn()}</svg>;
}

/* ---------- Avatar ---------- */
function Avatar({ agent, contact, name, initials, color, size = 32, presence, src }) {
  const a = agent || contact;
  const n = a ? a.name : name;
  const ini = a ? a.initials : initials;
  const col = a ? a.color : (color || '#5A6373');
  const pres = presence || (agent ? agent.presence : null);
  const fs = Math.round(size * 0.4);
  return (
    <span className="av" style={{ width: size, height: size, background: col, fontSize: fs }} title={n}>
      {src ? <img src={src} alt={n}/> : ini}
      {pres && <span className={'av-presence ' + pres} />}
    </span>
  );
}

/* ---------- Pills ---------- */
function Pill({ color, children, dot, large }) {
  return <span className={'pill pill-' + (color||'slate') + (large?' pill-lg':'')}>{dot && <span className="dot"/>}{children}</span>;
}
function ConvStatusPill({ status }) {
  const lang = useLang(); const s = window.HT.CONV_STATUS[status];
  return <Pill color={s.color} dot>{window.tr(s.key, lang)}</Pill>;
}
function OrderStatusPill({ status, large }) {
  const { state } = useApp(); const lang = state.lang;
  const name = window.HT.stageName(status, lang, state.config);
  const color = window.HT.stageColor(status, state.config);
  return <Pill color={color} dot large={large}>{name}</Pill>;
}
function AreaTag({ area, large }) {
  const { state } = useApp(); const lang = state.lang;
  const name = window.HT.areaName(area, lang, state.config); if (!name) return null;
  const color = window.HT.areaColor(area, state.config);
  return <Pill color={color} large={large}>{name}</Pill>;
}
function PriorityFlag({ priority, withLabel }) {
  const lang = useLang(); const p = window.HT.PRIORITY[priority];
  if (priority === 'low' && !withLabel) return null;
  return <Pill color={p.color}><Icon name="flag" size={12}/>{withLabel ? window.tr(p.key, lang) : window.tr(p.key, lang)}</Pill>;
}

/* ---------- Modal ---------- */
function Modal({ title, icon, iconColor, children, foot, onClose, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog">
        <div className="modal-head">
          {icon && <span className="t-ic" style={{ width:38, height:38, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--brand-50)', color:'var(--brand-700)', flex:'none' }}><Icon name={icon}/></span>}
          <h3 className="grow">{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="close"><Icon name="x"/></button>
        </div>
        <div className="modal-body scroll">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

/* ---------- Drawer ---------- */
function Drawer({ onClose, children }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (<><div className="scrim" onClick={onClose} /><aside className="drawer">{children}</aside></>);
}

/* ---------- Popover / Menu ---------- */
function Popover({ trigger, children, align = 'left', width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref} style={{ position:'relative', display:'inline-flex' }}>
      {trigger(open, () => setOpen(o => !o))}
      {open && (
        <div className="menu scroll" style={{ position:'absolute', top:'calc(100% + 6px)', [align]:0, width, maxHeight:340, overflowY:'auto' }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </span>
  );
}

/* ---------- Toast host ---------- */
function ToastHost() {
  const { state, dispatch } = useApp();
  useEffect(() => {
    const timers = state.toasts.map(t => setTimeout(() => dispatch({ type:'dismissToast', id:t.id }), t.ttl || 4200));
    return () => timers.forEach(clearTimeout);
  }, [state.toasts]);
  return (
    <div className="toast-host">
      {state.toasts.map(t => (
        <div className="toast" key={t.id}>
          <span className={'t-ic ' + (t.tone || 'brand')}><Icon name={t.icon || 'check'} size={17}/></span>
          <div style={{ minWidth:0 }}>
            <div className="toast-title">{t.title}</div>
            {t.sub && <div className="toast-sub truncate">{t.sub}</div>}
          </div>
          <button className="toast-x" onClick={() => dispatch({ type:'dismissToast', id:t.id })}><Icon name="x" size={15}/></button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Variable chip ---------- */
function VarChip({ children }) {
  return <span className="mono" style={{ display:'inline-flex', alignItems:'center', height:20, padding:'0 7px', borderRadius:6, background:'var(--brand-50)', color:'var(--brand-700)', border:'1px solid var(--brand-300)', fontSize:11.5, fontWeight:600 }}>{children}</span>;
}

/* ---------- helper: render body with {{vars}} highlighted ---------- */
function renderTemplate(body) {
  const parts = String(body).split(/(\{\{[^}]+\}\})/g);
  return parts.map((p, i) => /^\{\{.*\}\}$/.test(p) ? <VarChip key={i}>{p}</VarChip> : <React.Fragment key={i}>{p}</React.Fragment>);
}

/* ---------- Filter pill (shared by Orders, Kanban, Platform) ---------- */
function FilterPill({ icon, label, value, options, onPick }) {
  return (
    <Popover trigger={(open, tog) => (
      <button className="btn btn-sm btn-outline" onClick={tog} style={value ? { borderColor:'var(--brand)', color:'var(--brand-700)', background:'var(--brand-50)' } : null}>
        <Icon name={icon} size={14}/> {value ? options.find(o => o.id === value).label : label} <Icon name="chevd" size={13}/>
      </button>
    )}>
      {(close) => (<div style={{ minWidth:170 }}>
        {options.map(o => (<button className="menu-item" key={String(o.id)} onClick={() => { onPick(o.id); close(); }}>{o.swatch}{o.label}{value===o.id && <Icon name="check" size={15}/>}</button>))}
      </div>)}
    </Popover>
  );
}

Object.assign(window, {
  useState, useEffect, useRef, useCallback, useContext, useReducer, useMemo,
  HTCtx, useApp, useLang, useT,
  Icon, Avatar, Pill, ConvStatusPill, OrderStatusPill, AreaTag, PriorityFlag,
  Modal, Drawer, Popover, ToastHost, VarChip, renderTemplate, FilterPill,
});
