/* ============================================================
   HIRATICKET — Platform console: billing, plans, usage,
   connections, audit + reducer & mount
   ============================================================ */

/* ---------- Billing ---------- */
function BillingView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const M = window.PLAT.METRICS;
  const subs = window.PLAT.TENANTS.filter(x => x.status !== 'canceled');
  const tab = state.billingTab;
  return (
    <div className="page-pad scroll" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div className="row"><h1 style={{ fontSize:22 }}>{t('p_billing_title')}</h1></div>
      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(3,1fr)' }}>
        <KPI icon="check" label={t('collected')} value={window.PLAT.money(M.collectedMTD)} unit="MXN" />
        <KPI icon="clock" label={t('outstanding')} value={window.PLAT.money(M.outstanding)} unit="MXN" />
        <KPI icon="alert" label={t('failed_pay')} value={M.failedPayments} />
      </div>
      <div className="pcard">
        <div className="pcard-head" style={{ gap:12 }}>
          <div className="seg">
            <button className={tab==='subs'?'on':''} onClick={()=>dispatch({ type:'setBillingTab', tab:'subs' })}>{t('tab_subs')}</button>
            <button className={tab==='invoices'?'on':''} onClick={()=>dispatch({ type:'setBillingTab', tab:'invoices' })}>{t('tab_invoices')}</button>
          </div>
          <span className="grow" />
          <button className="btn btn-sm btn-ghost"><Icon name="download" size={14}/>{t('export')}</button>
        </div>
        <div className="tablewrap scroll" style={{ margin:0, border:'none', borderRadius:0, boxShadow:'none' }}>
          {tab==='subs' ? (
            <table className="tbl" style={{ minWidth:840 }}>
              <thead><tr><th>{t('col_business')}</th><th>{t('col_plan')}</th><th>{t('p_status')}</th><th>{t('col_mrr')}</th><th>{t('td_next_invoice')}</th><th>{t('col_method')}</th></tr></thead>
              <tbody>
                {subs.map(x=>(
                  <tr key={x.id} onClick={()=>dispatch({ type:'selectTenant', id:x.id })}>
                    <td><div className="biz-cell"><BizLogo t={x} size={28}/><span style={{ fontWeight:600 }} className="truncate">{x.name}</span></div></td>
                    <td><PlanPill plan={x.plan} /></td>
                    <td><SubPill status={x.status} /></td>
                    <td><span className="mono" style={{ fontWeight:700 }}>{x.status==='trial'?window.PLAT.money(0):window.PLAT.money(window.planById(x.plan).priceMonthly)}</span></td>
                    <td className="muted t-sm">{x.status==='trial'?(lang==='es'?'Al terminar prueba':'After trial'):'1 Jul'}</td>
                    <td><span className="mono t-sm muted">•••• 4242</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="tbl" style={{ minWidth:840 }}>
              <thead><tr><th>{t('col_invoice')}</th><th>{t('col_business')}</th><th>{t('col_amount')}</th><th>{t('col_date')}</th><th>{t('col_method')}</th><th>{t('p_status')}</th><th></th></tr></thead>
              <tbody>
                {window.PLAT.INV.map(inv=>{ const x=window.PLAT.tenantById(inv.tenant); const s=window.PLAT.INV_STATUS[inv.status]; return (
                  <tr key={inv.id} style={{ cursor:'default' }}>
                    <td><span className="mono" style={{ fontWeight:700 }}>{inv.id}</span></td>
                    <td><div className="biz-cell"><BizLogo t={x} size={24}/><span className="t-sm truncate" style={{ maxWidth:160 }}>{x.name}</span></div></td>
                    <td><span className="mono" style={{ fontWeight:700 }}>{window.PLAT.moneyMXN(inv.amount)}</span></td>
                    <td className="muted t-sm">{window.L(inv.date, lang)}</td>
                    <td><span className="mono t-sm muted">{inv.method}</span></td>
                    <td><Pill color={s.color} dot>{t(s.key)}</Pill></td>
                    <td>{inv.status==='failed' && <button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'toast', toast:{ icon:'refresh', tone:'blue', title:t('retry_charge'), sub:x.name } })}><Icon name="refresh" size={13}/>{t('retry_charge')}</button>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Plans ---------- */
const FLAGS = [
  { k:{ en:'Unified inbox', es:'Bandeja unificada' }, plans:['inicio','pro','negocio'] },
  { k:{ en:'Orders & Kanban', es:'Pedidos y Kanban' }, plans:['inicio','pro','negocio'] },
  { k:{ en:'Templates', es:'Plantillas' }, plans:['inicio','pro','negocio'] },
  { k:{ en:'Areas & routing', es:'Áreas y ruteo' }, plans:['pro','negocio'] },
  { k:{ en:'Roles & permissions', es:'Roles y permisos' }, plans:['pro','negocio'] },
  { k:{ en:'Metrics & reports', es:'Métricas y reportes' }, plans:['pro','negocio'] },
  { k:{ en:'API & webhooks', es:'API y webhooks' }, plans:['negocio'] },
  { k:{ en:'Audit log', es:'Bitácora de auditoría' }, plans:['negocio'] },
  { k:{ en:'Priority SLA', es:'SLA prioritario' }, plans:['negocio'] },
];
function PlansView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  return (
    <div className="page-pad scroll" style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div className="row"><h1 style={{ fontSize:22 }}>{t('p_plans_title')}</h1><span className="grow"/><button className="btn btn-primary" onClick={()=>dispatch({ type:'toast', toast:{ icon:'plus', title: lang==='es'?'Nuevo plan':'New plan' } })}><Icon name="plus" size={16}/>{t('create_plan')}</button></div>
      <div className="plan-grid">
        {window.PLANS.map(p=>(
          <div key={p.id} className={'plan-card'+(p.popular?' pop':'')}>
            {p.popular && <span className="pill pill-brand" style={{ position:'absolute', top:16, right:16 }}>★ {lang==='es'?'Popular':'Popular'}</span>}
            <div><div className="row gap-2"><span className="dot" style={{ width:10, height:10, borderRadius:9, background:'var(--'+p.color+')' }}/><span style={{ fontWeight:800, fontSize:16 }}>{window.L(p.name, lang)}</span></div><div className="t-sm muted" style={{ marginTop:4 }}>{window.L(p.tagline, lang)}</div></div>
            <div className="plan-price"><span className="amt mono">{window.PLAT.money(p.priceMonthly)}</span><span className="per">MXN {t('per_mo')}</span></div>
            <div className="plan-limits">
              <div className="limit-row"><Icon name="agents" size={15}/><strong>{p.limits.agents<0?t('unlimited'):p.limits.agents}</strong> {t('limit_agents')}</div>
              <div className="limit-row"><Icon name="whatsapp" size={15}/><strong>{p.limits.numbers}</strong> {t('limit_numbers')}</div>
              <div className="limit-row"><Icon name="chat" size={15}/><strong>{p.limits.msgs<0?t('unlimited'):p.limits.msgs.toLocaleString('es-MX')}</strong> {t('limit_msgs')}</div>
            </div>
            <div className="row"><span className="grow t-sm muted">{p.subscribers} {t('subscribers')}</span><button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'toast', toast:{ icon:'edit', title: t('edit_plan')+' · '+window.L(p.name,lang) } })}><Icon name="edit" size={13}/>{t('edit_plan')}</button></div>
          </div>
        ))}
      </div>
      <div className="pcard">
        <div className="pcard-head"><Icon name="shield" size={17}/><h3>{t('feature_flags')}</h3></div>
        <div className="tablewrap scroll" style={{ margin:0, border:'none', borderRadius:0, boxShadow:'none' }}>
          <table className="flag-grid" style={{ minWidth:560 }}>
            <thead><tr><th>{t('feature_flags')}</th>{window.PLANS.map(p=><th key={p.id} className="center">{window.L(p.name, lang)}</th>)}</tr></thead>
            <tbody>
              {FLAGS.map((f,i)=>(<tr key={i}><td style={{ fontWeight:600 }}>{window.L(f.k, lang)}</td>{window.PLANS.map(p=><td key={p.id} className="center">{f.plans.includes(p.id)?<span className="flag-yes"><Icon name="check" size={16}/></span>:<span className="flag-no"><Icon name="x" size={15}/></span>}</td>)}</tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- Usage ---------- */
function UsageView() {
  const { state } = useApp(); const t = useT(); const lang = state.lang;
  const rows = window.PLAT.TENANTS.filter(x=>x.status!=='canceled');
  const bar = (used, max) => { const p = max<0?12:Math.min(100,Math.round(used/max*100)); const cls = max<0?'':p>=90?'danger':p>=70?'warn':''; return (<div style={{ minWidth:120 }}><div className={'progress '+cls}><span style={{ width:(max<0?14:p)+'%' }}/></div><div className="t-xs muted" style={{ marginTop:3 }}>{max<0?t('unlimited'):used.toLocaleString('es-MX')+' / '+max.toLocaleString('es-MX')}</div></div>); };
  return (
    <div className="page">
      <div className="phead"><h1>{t('p_usage_title')}</h1></div>
      <div className="tablewrap scroll" style={{ marginTop:8 }}>
        <table className="tbl" style={{ minWidth:840 }}>
          <thead><tr><th>{t('col_business')}</th><th>{t('col_plan')}</th><th style={{ width:200 }}>{t('u_messages')}</th><th>{t('u_agents')}</th><th>{t('u_orders')} (30d)</th></tr></thead>
          <tbody>
            {rows.map(x=>{ const lim=window.planById(x.plan).limits; const near = lim.msgs>0 && x.msgs/lim.msgs>=0.7; return (
              <tr key={x.id} style={{ cursor:'default' }}>
                <td><div className="biz-cell"><BizLogo t={x} size={28}/><span style={{ fontWeight:600 }} className="truncate">{x.name}</span>{near&&<Pill color="amber">{t('near_limit')}</Pill>}</div></td>
                <td><PlanPill plan={x.plan} /></td>
                <td>{bar(x.msgs, lim.msgs)}</td>
                <td><span className="mono">{x.agents}{lim.agents>0?' / '+lim.agents:''}</span></td>
                <td><span className="mono" style={{ fontWeight:700 }}>{x.orders}</span></td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Connections (WhatsApp health) ---------- */
function ConnectionsView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const rows = window.PLAT.TENANTS;
  const counts = { connected:0, needs_qr:0, disconnected:0 };
  rows.forEach(x=>counts[x.wa]++);
  return (
    <div className="page-pad scroll" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div className="row"><h1 style={{ fontSize:22 }}>{t('p_conn_title')}</h1></div>
      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(3,1fr)' }}>
        <KPI icon="wifi" label={t('wa_connected')} value={counts.connected} />
        <KPI icon="qr" label={t('wa_needsqr')} value={counts.needs_qr} />
        <KPI icon="wifioff" label={t('wa_down')} value={counts.disconnected} />
      </div>
      <div className="tablewrap scroll" style={{ margin:0 }}>
        <table className="tbl" style={{ minWidth:820 }}>
          <thead><tr><th>{t('col_business')}</th><th>{t('numbers')}</th><th>{t('p_status')}</th><th>{t('uptime')}</th><th>{t('last_seen')}</th><th></th></tr></thead>
          <tbody>
            {rows.map(x=>{ const up = x.wa==='connected'?(99-x.numbers*0.2).toFixed(1):x.wa==='needs_qr'?'—':(82.4).toFixed(1); return (
              <tr key={x.id} onClick={()=>dispatch({ type:'selectTenant', id:x.id })}>
                <td><div className="biz-cell"><BizLogo t={x} size={28}/><span style={{ fontWeight:600 }} className="truncate">{x.name}</span></div></td>
                <td><span className="mono">{x.numbers}</span></td>
                <td><WaPill status={x.wa} /></td>
                <td><span className="mono">{up}{up!=='—'?'%':''}</span></td>
                <td className="muted t-sm">{window.L(x.active, lang)}</td>
                <td>{x.wa!=='connected' && <button className="btn btn-sm btn-outline" onClick={(e)=>{ e.stopPropagation(); dispatch({ type:'toast', toast:{ icon:'qr', tone:'brand', title: lang==='es'?'QR reenviado al dueño':'QR re-sent to owner', sub:x.name } }); }}><Icon name="qr" size={13}/>{lang==='es'?'Reenviar QR':'Resend QR'}</button>}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Audit ---------- */
function AuditView() {
  const { state } = useApp(); const t = useT(); const lang = state.lang;
  return (
    <div className="page-pad scroll">
      <div className="row" style={{ marginBottom:16 }}><h1 style={{ fontSize:22 }}>{t('p_audit_title')}</h1></div>
      <div className="pcard" style={{ maxWidth:720 }}>
        <div className="pcard-body"><div className="timeline">
          {window.PLAT.AUDIT.map((e,i)=>{ const x=window.PLAT.tenantById(e.tenant); return (
            <div className="tl" key={i}><div className="tl-dot"><div className="tl-ic" style={{ color:'var(--'+e.tone+')', background:'var(--'+e.tone+'-bg)', borderColor:'var(--'+e.tone+'-bd)' }}><Icon name={e.ic} size={13}/></div></div>
              <div className="tl-body"><strong>{t(e.type)}</strong>{e.detail&&<span className="muted"> · {e.detail}</span>}<div className="row gap-2" style={{ marginTop:2 }}><BizLogo t={x} size={18}/><span className="t-sm muted">{x.name}</span><span className="t-xs faint">· {window.L(e.time, lang)}</span></div></div>
            </div>
          ); })}
        </div></div>
      </div>
    </div>
  );
}

/* ---------- Reducer + App ---------- */
const PLS = (k, d) => { try { const v = localStorage.getItem('ht_'+k); return v==null?d:JSON.parse(v); } catch(e){ return d; } };
const PsaveLS = (k, v) => { try { localStorage.setItem('ht_'+k, JSON.stringify(v)); } catch(e){} };
let pToastSeq = 0;
function pPushToast(toasts, t){ return [...toasts, Object.assign({ id:++pToastSeq }, t)].slice(-4); }

function pInit() {
  return {
    lang: PLS('lang','es'), theme: PLS('theme','light'), density:'comfortable',
    route:'overview', search:'', selectedTenant:null,
    tenantFilters:{ plan:null, status:null }, billingTab:'subs',
    toasts:[], modal:null,
  };
}
function pReducer(state, a) {
  switch (a.type) {
    case 'navigate': return { ...state, route:a.route };
    case 'setLang': PsaveLS('lang', a.lang); return { ...state, lang:a.lang };
    case 'setTheme': PsaveLS('theme', a.theme); return { ...state, theme:a.theme };
    case 'setSearch': return { ...state, search:a.value };
    case 'selectTenant': return { ...state, selectedTenant:a.id };
    case 'closeTenant': return { ...state, selectedTenant:null };
    case 'setTenantFilter': return { ...state, tenantFilters:{ ...state.tenantFilters, ...a.patch } };
    case 'setBillingTab': return { ...state, billingTab:a.tab };
    case 'toast': return { ...state, toasts: pPushToast(state.toasts, a.toast) };
    case 'dismissToast': return { ...state, toasts: state.toasts.filter(t=>t.id!==a.id) };
    default: return state;
  }
}

function PlatformRouter() {
  const { state } = useApp();
  switch (state.route) {
    case 'overview':    return <Dashboard />;
    case 'tenants':     return <TenantsView />;
    case 'billing':     return <BillingView />;
    case 'plans':       return <PlansView />;
    case 'usage':       return <UsageView />;
    case 'connections': return <ConnectionsView />;
    case 'audit':       return <AuditView />;
    default:            return <Dashboard />;
  }
}

function PlatformApp() {
  const [state, dispatch] = useReducer(pReducer, undefined, pInit);
  useEffect(() => { document.documentElement.dataset.theme = state.theme; }, [state.theme]);
  const ctx = useMemo(()=>({ state, dispatch }), [state]);
  return (
    <HTCtx.Provider value={ctx}>
      <div className="app">
        <PlatformRail />
        <div className="main">
          <PlatformTopBar />
          <PlatformRouter />
        </div>
        {state.selectedTenant && <TenantDrawer />}
        <ToastHost />
      </div>
    </HTCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PlatformApp />);
