/* ============================================================
   HIRATICKET — Platform console: shell, dashboard, tenants
   Reuses components.jsx primitives + HTCtx.
   ============================================================ */

/* ---------- shared platform pills ---------- */
function SubPill({ status }) { const lang = useLang(); const s = window.PLAT.SUB_STATUS[status]; return <Pill color={s.color} dot>{window.tr(s.key, lang)}</Pill>; }
function WaPill({ status, mini }) { const lang = useLang(); const s = window.PLAT.WA_STATUS[status]; return <Pill color={s.color} dot>{!mini && <Icon name={s.ic} size={12}/>}{window.tr(s.key, lang)}</Pill>; }
function PlanPill({ plan }) { const lang = useLang(); const p = window.planById(plan); return <Pill color={p.color}>{window.L(p.name, lang)}</Pill>; }
function BizLogo({ t, size = 32 }) { return <span className="biz-logo" style={{ background:t.owner.color, width:size, height:size, fontSize:Math.round(size*0.4) }}>{t.name.slice(0,2).toUpperCase()}</span>; }

/* ---------- Rail ---------- */
function PlatformRail() {
  const { state, dispatch } = useApp(); const t = useT();
  const items = [
    { id:'overview',    icon:'layers',   label:t('p_dashboard') },
    { id:'tenants',     icon:'store',     label:t('p_tenants') },
    { id:'billing',     icon:'orders',    label:t('p_billing') },
    { id:'plans',       icon:'sparkles',  label:t('p_plans') },
    { id:'usage',       icon:'sliders',   label:t('p_usage') },
    { id:'connections', icon:'whatsapp',  label:t('p_connections') },
    { id:'audit',       icon:'shield',    label:t('p_audit') },
  ];
  return (
    <nav className="rail">
      <div className="rail-logo" title="Hiraticket Platform">H</div>
      <div className="rail-nav">
        {items.map(it => (
          <button key={it.id} className={'rail-item' + (state.route===it.id?' on':'')} onClick={()=>dispatch({ type:'navigate', route:it.id })}>
            <Icon name={it.icon}/><span className="rl">{it.label}</span>
          </button>
        ))}
      </div>
      <div className="rail-foot">
        <a className="iconbtn tip tip-right" data-tip={t('back_to_app')} href="Hiraticket.html" style={{ color:'rgba(255,255,255,.7)' }}><Icon name="arrowr"/></a>
        <Popover align="left" trigger={(o,tog)=><button className="iconbtn" style={{ padding:2 }} onClick={tog}><Avatar name="Super Admin" initials="SA" color="#131310" size={38}/></button>}>
          {(close)=>(<div style={{ minWidth:200 }}>
            <div style={{ padding:'4px 8px 8px' }}><div style={{ fontWeight:700, fontSize:13 }}>Super Admin</div><div className="t-xs muted">ops@hiraticket.com</div></div>
            <div className="menu-sep" />
            <a className="menu-item" href="Hiraticket.html"><Icon name="arrowr" size={16}/>{t('back_to_app')}</a>
            <a className="menu-item" href="Landing.html"><Icon name="store" size={16}/>{state.lang==='es'?'Sitio público':'Public site'}</a>
            <a className="menu-item danger" href="Login.html"><Icon name="lock" size={16}/>{state.lang==='es'?'Cerrar sesión':'Sign out'}</a>
          </div>)}
        </Popover>
      </div>
    </nav>
  );
}

/* ---------- Top bar ---------- */
function PlatformTopBar() {
  const { state, dispatch } = useApp(); const t = useT();
  return (
    <header className="topbar">
      <div className="row gap-2" style={{ marginRight:6 }}>
        <span style={{ fontWeight:800, fontSize:15 }} className="display">Hiraticket</span>
        <Pill color="brand">{t('super_admin')}</Pill>
      </div>
      <div className="topbar-search" style={{ marginLeft:8 }}>
        <div className="field field-filled"><Icon name="search"/><input placeholder={t('p_search')} value={state.search} onChange={e=>dispatch({ type:'setSearch', value:e.target.value })}/></div>
      </div>
      <span className="grow" />
      <div className="seg" style={{ height:34 }}>
        <button className={state.lang==='es'?'on':''} onClick={()=>dispatch({ type:'setLang', lang:'es' })}>ES</button>
        <button className={state.lang==='en'?'on':''} onClick={()=>dispatch({ type:'setLang', lang:'en' })}>EN</button>
      </div>
      <button className="iconbtn" onClick={()=>dispatch({ type:'setTheme', theme: state.theme==='dark'?'light':'dark' })}><Icon name={state.theme==='dark'?'sun':'moon'}/></button>
      <a className="btn btn-outline" href="Hiraticket.html"><Icon name="arrowr" size={15}/>{t('back_to_app')}</a>
    </header>
  );
}

/* ---------- Dashboard ---------- */
function Delta({ v, invert }) {
  const up = v > 0; const good = invert ? !up : up;
  return <span className={'delta ' + (v===0?'flat':good?'up':'down')}><span style={{ display:'inline-flex', transform: up?'rotate(180deg)':'none' }}><Icon name="chevd" size={12}/></span>{Math.abs(v)}%</span>;
}
function KPI({ icon, label, value, unit, delta, invert }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><span className="ic"><Icon name={icon} size={16}/></span>{label}</div>
      <div className="kpi-val">{value}{unit && <span className="unit">{unit}</span>}</div>
      {delta != null && <div className="row gap-2"><Delta v={delta} invert={invert} /><span className="t-xs muted">{useT()('vs_last')}</span></div>}
    </div>
  );
}

function Dashboard() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const M = window.PLAT.METRICS;
  const maxTrend = Math.max(...M.mrrTrend);
  const maxMix = Math.max(...M.planMix.map(p=>p.count));
  const attention = window.PLAT.TENANTS.filter(x => x.status==='past_due' || x.wa==='disconnected' || x.status==='trial');
  const recent = window.PLAT.TENANTS.filter(x => window.L(x.joined,'en').includes('ago') || window.L(x.joined,'en').includes('days'));

  return (
    <div className="page-pad scroll" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div className="row"><h1 style={{ fontSize:22 }}>{t('p_overview_title')}</h1><span className="grow"/><Pill color="slate" large><Icon name="calendar" size={12}/>{t('this_month')}</Pill></div>

      <div className="kpi-grid">
        <KPI icon="orders" label={t('kpi_mrr')} value={window.PLAT.money(M.mrr)} unit="MXN" delta={M.deltas.mrr} />
        <KPI icon="store" label={t('kpi_active')} value={M.activeBiz} delta={M.deltas.activeBiz} />
        <KPI icon="clock" label={t('kpi_trials')} value={M.trials} delta={M.deltas.newThisMonth} />
        <KPI icon="refresh" label={t('kpi_churn')} value={M.churn} unit="%" delta={M.deltas.churn} invert />
      </div>

      <div className="two-col">
        <div className="pcard">
          <div className="pcard-head"><Icon name="orders" size={17}/><h3 className="grow">{t('mrr_trend')}</h3><span className="kpi-val" style={{ fontSize:18 }}>{window.PLAT.money(M.mrr)} <span className="unit">MXN</span></span></div>
          <div className="pcard-body">
            <div className="chart">
              {M.mrrTrend.map((v,i)=>(
                <div className="chart-col" key={i}>
                  <div className="chart-bar tip" data-tip={window.PLAT.money(v)+' MXN'} style={{ height:(v/maxTrend*100)+'%' }} />
                  <span className="chart-lbl">{M.mrrTrendLabels[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="pcard">
          <div className="pcard-head"><Icon name="sparkles" size={17}/><h3 className="grow">{t('plan_mix')}</h3></div>
          <div className="pcard-body">
            <div className="distro">
              {M.planMix.map(p=>(
                <div className="distro-row" key={p.id}>
                  <span style={{ fontWeight:600 }}>{window.L(p.name, lang)}</span>
                  <div className="distro-track"><div className="distro-fill" style={{ width:(p.count/maxMix*100)+'%', background:'var(--'+p.color+')' }}/></div>
                  <span className="mono" style={{ textAlign:'right', fontWeight:700 }}>{p.count}</span>
                </div>
              ))}
            </div>
            <div className="hr" style={{ margin:'14px 0' }} />
            <div className="row"><span className="muted t-sm grow">{t('kpi_arpa')}</span><span style={{ fontWeight:700 }} className="mono">{window.PLAT.moneyMXN(M.arpa)}</span></div>
            <div className="row" style={{ marginTop:6 }}><span className="muted t-sm grow">{t('kpi_arr')}</span><span style={{ fontWeight:700 }} className="mono">{window.PLAT.moneyMXN(M.arr)}</span></div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="pcard">
          <div className="pcard-head"><Icon name="plus" size={17}/><h3 className="grow">{t('recent_signups')}</h3><button className="btn btn-sm btn-ghost" onClick={()=>dispatch({ type:'navigate', route:'tenants' })}>{t('view_all')}</button></div>
          <div className="pcard-body" style={{ padding:'6px 8px' }}>
            {recent.map(x=>(
              <button className="menu-item" key={x.id} onClick={()=>dispatch({ type:'selectTenant', id:x.id })} style={{ padding:'9px 8px' }}>
                <BizLogo t={x} size={30}/>
                <span className="grow" style={{ textAlign:'left', minWidth:0 }}><span style={{ display:'block', fontWeight:600 }} className="truncate">{x.name}</span><span className="t-xs muted">{x.owner.name} · {window.L(x.joined, lang)}</span></span>
                <PlanPill plan={x.plan} />
              </button>
            ))}
          </div>
        </div>
        <div className="pcard">
          <div className="pcard-head"><Icon name="alert" size={17}/><h3 className="grow">{t('needs_attention')}</h3><span className="badge badge-red">{attention.length}</span></div>
          <div className="pcard-body" style={{ padding:'6px 8px' }}>
            {attention.map(x=>{
              const reason = x.status==='past_due' ? { c:'amber', ic:'orders', tx: lang==='es'?'Pago vencido':'Payment past due' } : x.wa==='disconnected' ? { c:'red', ic:'wifioff', tx: lang==='es'?'WhatsApp caído':'WhatsApp down' } : { c:'blue', ic:'clock', tx: lang==='es'?'En prueba':'On trial' };
              return (<button className="menu-item" key={x.id} onClick={()=>dispatch({ type:'selectTenant', id:x.id })} style={{ padding:'9px 8px' }}>
                <span className="t-ic" style={{ width:30, height:30, borderRadius:9, background:'var(--'+reason.c+'-bg)', color:'var(--'+reason.c+')', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name={reason.ic} size={15}/></span>
                <span className="grow" style={{ textAlign:'left', minWidth:0 }}><span style={{ display:'block', fontWeight:600 }} className="truncate">{x.name}</span><span className="t-xs muted">{reason.tx}</span></span>
                <Icon name="chevr" size={16}/>
              </button>);
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Tenants ---------- */
function TenantsView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const f = state.tenantFilters;
  const setF = (patch)=>dispatch({ type:'setTenantFilter', patch });
  let rows = window.PLAT.TENANTS.filter(x=>{
    if (f.plan && x.plan!==f.plan) return false;
    if (f.status && x.status!==f.status) return false;
    const q = (state.search||'').toLowerCase();
    if (q && !(x.name.toLowerCase().includes(q) || x.owner.name.toLowerCase().includes(q))) return false;
    return true;
  });
  return (
    <div className="page">
      <div className="phead"><h1>{t('p_tenants_title')}</h1><Pill color="slate" large>{rows.length}</Pill></div>
      <div className="toolbar">
        <FilterPill icon="sparkles" label={t('col_plan')} value={f.plan} onPick={(v)=>setF({ plan:f.plan===v?null:v })} options={[{ id:null, label:t('all_plans') }, ...window.PLANS.map(p=>({ id:p.id, label:window.L(p.name,lang) }))]} />
        <FilterPill icon="status" label={t('p_status')} value={f.status} onPick={(v)=>setF({ status:f.status===v?null:v })} options={[{ id:null, label:t('all_status') }, ...Object.keys(window.PLAT.SUB_STATUS).map(s=>({ id:s, label:t(window.PLAT.SUB_STATUS[s].key) }))]} />
        <span className="grow" />
        <button className="btn btn-sm btn-ghost"><Icon name="download" size={14}/>{useT()('export') || 'Export'}</button>
      </div>
      <div className="tablewrap scroll">
        <table className="tbl" style={{ minWidth:980 }}>
          <thead><tr>
            <th>{t('col_business')}</th><th>{t('col_owner')}</th><th>{t('col_plan')}</th><th>{t('p_status')}</th>
            <th>{t('col_seats')}</th><th>{t('col_wa')}</th><th>{t('col_mrr')}</th><th>{t('col_active')}</th>
          </tr></thead>
          <tbody>
            {rows.map(x=>(
              <tr key={x.id} onClick={()=>dispatch({ type:'selectTenant', id:x.id })}>
                <td><div className="biz-cell"><BizLogo t={x}/><div style={{ minWidth:0 }}><div style={{ fontWeight:700 }} className="truncate">{x.name}</div><div className="t-xs muted">{x.city} · MX</div></div></div></td>
                <td><div className="biz-cell"><Avatar name={x.owner.name} initials={x.owner.initials} color={x.owner.color} size={24}/><span className="t-sm truncate" style={{ maxWidth:120 }}>{x.owner.name}</span></div></td>
                <td><PlanPill plan={x.plan} /></td>
                <td><SubPill status={x.status} /></td>
                <td><span className="mono" style={{ fontWeight:700 }}>{x.agents}</span></td>
                <td><WaPill status={x.wa} /></td>
                <td><span className="mono" style={{ fontWeight:700 }}>{x.status==='active'||x.status==='past_due'?window.PLAT.money(window.planById(x.plan).priceMonthly):window.PLAT.money(0)}</span></td>
                <td className="muted t-sm">{window.L(x.active, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Tenant drawer ---------- */
function TenantDrawer() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const x = window.PLAT.tenantById(state.selectedTenant);
  if (!x) return null;
  const plan = window.planById(x.plan);
  const close = ()=>dispatch({ type:'closeTenant' });
  const events = window.PLAT.AUDIT.filter(e=>e.tenant===x.id);
  const lim = plan.limits;
  const pct = (used, max)=> max<0 ? 12 : Math.min(100, Math.round(used/max*100));
  const usageBar = (used, max, fmtUsed) => {
    const p = pct(used, max); const cls = max<0 ? '' : p>=90?'danger':p>=70?'warn':'';
    return (<div><div className="row" style={{ marginBottom:5 }}><span className="t-sm muted grow">{fmtUsed}</span><span className="t-xs muted">{max<0?t('unlimited'):used+' / '+max}</span></div><div className={'progress '+cls}><span style={{ width:(max<0?14:p)+'%' }}/></div></div>);
  };

  return (
    <Drawer onClose={close}>
      <div className="drawer-head">
        <BizLogo t={x} size={42}/>
        <div className="grow" style={{ minWidth:0 }}>
          <div className="row gap-2"><span style={{ fontWeight:800, fontSize:16 }} className="truncate">{x.name}</span><SubPill status={x.status} /></div>
          <div className="t-sm muted">{x.city} · MX · {t('td_since')} {window.L(x.joined, lang)}</div>
        </div>
        <button className="iconbtn" onClick={close}><Icon name="x"/></button>
      </div>
      <div className="drawer-body scroll">
        {/* owner */}
        <div className="pcard"><div className="pcard-head"><Icon name="user" size={16}/><h3>{t('td_owner')}</h3></div>
          <div className="pcard-body row gap-3"><Avatar name={x.owner.name} initials={x.owner.initials} color={x.owner.color} size={40}/><div className="grow" style={{ minWidth:0 }}><div style={{ fontWeight:700 }}>{x.owner.name}</div><div className="t-sm muted">{x.owner.email}</div></div><a className="btn btn-sm btn-outline" href="Hiraticket.html"><Icon name="arrowr" size={14}/>{t('td_open_app')}</a></div>
        </div>
        {/* subscription */}
        <div className="pcard"><div className="pcard-head"><Icon name="orders" size={16}/><h3 className="grow">{t('td_subscription')}</h3><PlanPill plan={x.plan} /></div>
          <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div className="row"><span className="muted t-sm grow">{t('col_mrr')}</span><span className="mono" style={{ fontWeight:700 }}>{x.status==='active'||x.status==='past_due'?window.PLAT.moneyMXN(plan.priceMonthly):window.PLAT.moneyMXN(0)}</span></div>
            <div className="row"><span className="muted t-sm grow">{t('td_next_invoice')}</span><span className="t-sm" style={{ fontWeight:600 }}>{x.status==='canceled'?'—':x.status==='trial'?(lang==='es'?'Al terminar prueba':'After trial'):'1 Jul'}</span></div>
            <div className="row"><span className="muted t-sm grow">{t('td_method')}</span><span className="mono t-sm">•••• 4242</span></div>
            <div className="row gap-2" style={{ marginTop:4 }}>
              <button className="btn btn-sm btn-outline grow" onClick={()=>dispatch({ type:'toast', toast:{ icon:'sparkles', tone:'blue', title: lang==='es'?'Plan actualizado':'Plan changed', sub:x.name } })}><Icon name="sparkles" size={14}/>{t('td_change_plan')}</button>
              {x.status==='canceled'||x.status==='paused'
                ? <button className="btn btn-sm btn-primary grow" onClick={()=>dispatch({ type:'toast', toast:{ icon:'check', tone:'green', title: lang==='es'?'Reactivado':'Reactivated', sub:x.name } })}><Icon name="check" size={14}/>{t('td_activate')}</button>
                : <button className="btn btn-sm btn-danger grow" onClick={()=>dispatch({ type:'toast', toast:{ icon:'shield', tone:'brand', title: lang==='es'?'Negocio suspendido':'Business suspended', sub:x.name } })}><Icon name="shield" size={14}/>{t('td_suspend')}</button>}
            </div>
          </div>
        </div>
        {/* usage */}
        <div className="pcard"><div className="pcard-head"><Icon name="sliders" size={16}/><h3>{t('td_usage')}</h3></div>
          <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {usageBar(x.agents, lim.agents, t('td_seats_used'))}
            {usageBar(x.msgs, lim.msgs, t('td_messages'))}
            <div className="row"><span className="t-sm muted grow">{t('td_orders')} (30d)</span><span className="mono" style={{ fontWeight:700 }}>{x.orders}</span></div>
          </div>
        </div>
        {/* connections */}
        <div className="pcard"><div className="pcard-head"><Icon name="whatsapp" size={16}/><h3 className="grow">{t('td_connections')}</h3><WaPill status={x.wa} /></div>
          <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {Array.from({length:x.numbers}).map((_,i)=>(
              <div key={i} className="row gap-3" style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-md)' }}>
                <Icon name="whatsapp" size={16}/><span className="mono t-sm grow">+52 55 1{x.id.length}0{i} {(2000+i*111)}</span>
                <WaPill status={i===0?x.wa:'connected'} mini />
              </div>
            ))}
          </div>
        </div>
        {/* activity */}
        {events.length>0 && (
          <div className="pcard"><div className="pcard-head"><Icon name="clock" size={16}/><h3>{t('p_audit')}</h3></div>
            <div className="pcard-body"><div className="timeline">
              {events.map((e,i)=>(<div className="tl" key={i}><div className="tl-dot"><div className="tl-ic" style={{ color:'var(--'+e.tone+')' }}><Icon name={e.ic} size={13}/></div></div><div className="tl-body">{t(e.type)}{e.detail&&<span className="muted"> · {e.detail}</span>}<div className="tl-time">{window.L(e.time, lang)}</div></div></div>))}
            </div></div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

Object.assign(window, { SubPill, WaPill, PlanPill, BizLogo, PlatformRail, PlatformTopBar, Dashboard, KPI, Delta, TenantsView, TenantDrawer });
