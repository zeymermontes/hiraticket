/* ============================================================
   HIRATICKET — Automations / Workflows view
   ============================================================ */

/* describe the value chip for a trigger or action */
function flowTriggerValue(trigger, lang) {
  if (trigger.type === 'order_status') { const s = window.HT.orderStatusById(trigger.value); return s ? window.tr(s.key, lang) : null; }
  if (trigger.type === 'conv_status') { const s = window.HT.CONV_STATUS[trigger.value]; return s ? window.tr(s.key, lang) : null; }
  return null;
}
function flowActionValue(action, lang) {
  if (action.type === 'send_template') { const k = window.HT.cannedById(action.template); return k ? window.L(k.title, lang) : null; }
  if (action.type === 'transfer_area') { const ar = window.HT.areaById(action.area); return ar ? window.L(ar.name, lang) : null; }
  if (action.type === 'assign_agent') { const ag = window.HT.agentById(action.agent); return ag ? ag.name : null; }
  if (action.type === 'add_tag') return action.tag || 'VIP';
  return null;
}

function FlowCard({ flow }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const trg = window.HT.triggerById(flow.trigger.type);
  const act = window.HT.actionById(flow.action.type);
  const tv = flowTriggerValue(flow.trigger, lang);
  const av = flowActionValue(flow.action, lang);
  return (
    <div className={'flow-card' + (flow.enabled ? '' : ' off')}>
      <button className={'switch' + (flow.enabled ? ' on' : '')} onClick={()=>dispatch({ type:'toggleAutomation', id:flow.id })} aria-label="toggle" />
      <div className="grow" style={{ minWidth:0 }}>
        <div className="row gap-2">
          <span style={{ fontWeight:700, fontSize:14.5 }}>{window.L(flow.name, lang)}</span>
          <Pill color={flow.enabled ? 'green' : 'slate'} dot>{flow.enabled ? t('flow_active') : t('flow_paused')}</Pill>
          <span className="grow" />
          <span className="t-xs muted"><span className="mono" style={{ fontWeight:700, color:'var(--text)' }}>{flow.runs.toLocaleString('es-MX')}</span> {t('runs_count')}</span>
        </div>
        <div className="flow-line">
          <span className="flow-node when"><Icon name={trg.icon} size={14}/>{t('flow_when')} {window.tr(trg.key, lang).toLowerCase()}</span>
          {tv && <span className="pill pill-slate">{tv}</span>}
          <span className="flow-arrow"><Icon name="arrowr" size={16}/></span>
          <span className="flow-node then"><Icon name={act.icon} size={14}/>{window.tr(act.key, lang)}</span>
          {av && <span className="pill pill-brand">{av}</span>}
        </div>
      </div>
      <Popover align="right" trigger={(o,tog)=><button className="iconbtn" onClick={tog}><Icon name="dots"/></button>}>
        {(close)=>(<div>
          <button className="menu-item" onClick={()=>{ dispatch({ type:'openModal', modal:{ type:'flowEdit', id:flow.id } }); close(); }}><Icon name="edit" size={16}/>{lang==='es'?'Editar':'Edit'}</button>
          <button className="menu-item" onClick={()=>{ dispatch({ type:'toggleAutomation', id:flow.id }); close(); }}><Icon name={flow.enabled?'clock':'check'} size={16}/>{flow.enabled?(lang==='es'?'Pausar':'Pause'):(lang==='es'?'Activar':'Activate')}</button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={()=>{ dispatch({ type:'deleteAutomation', id:flow.id }); close(); }}><Icon name="trash" size={16}/>{lang==='es'?'Eliminar':'Delete'}</button>
        </div>)}
      </Popover>
    </div>
  );
}

function AutomationsView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const flows = state.automations;
  const activeN = flows.filter(f=>f.enabled).length;
  const automatedMsgs = flows.filter(f=>f.enabled && f.action.type==='send_template').reduce((s,f)=>s+f.runs, 0);
  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>{t('flows_title')}</h1>
          <div className="sub">{t('flows_sub')}</div>
        </div>
        <span className="grow" />
        <button className="btn btn-primary" onClick={()=>dispatch({ type:'openModal', modal:{ type:'flowEdit' } })}><Icon name="plus" size={16}/>{t('new_flow')}</button>
      </div>
      <div className="page-pad scroll" style={{ display:'flex', flexDirection:'column', gap:14, maxWidth:880 }}>
        <div className="row gap-3">
          <div className="card card-pad grow row gap-3" style={{ alignItems:'center' }}>
            <span className="t-ic" style={{ width:42, height:42, borderRadius:12, background:'var(--green-bg)', color:'var(--green)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="bolt"/></span>
            <div><div style={{ fontSize:22, fontWeight:800, lineHeight:1 }}>{activeN}</div><div className="t-sm muted" style={{ marginTop:3 }}>{t('enabled_flows')}</div></div>
          </div>
          <div className="card card-pad grow row gap-3" style={{ alignItems:'center' }}>
            <span className="t-ic" style={{ width:42, height:42, borderRadius:12, background:'var(--brand-50)', color:'var(--brand-700)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="send"/></span>
            <div><div style={{ fontSize:22, fontWeight:800, lineHeight:1 }}>{automatedMsgs.toLocaleString('es-MX')}</div><div className="t-sm muted" style={{ marginTop:3 }}>{t('msgs_automated')}</div></div>
          </div>
        </div>
        {flows.length === 0
          ? <div className="empty"><div className="empty-art"><Icon name="bolt"/></div><h3>{t('new_flow')}</h3><p>{t('flows_sub')}</p><button className="btn btn-primary" onClick={()=>dispatch({ type:'openModal', modal:{ type:'flowEdit' } })}><Icon name="plus" size={15}/>{t('new_flow')}</button></div>
          : flows.map(f => <FlowCard key={f.id} flow={f} />)}
        <div className="row gap-2 t-sm muted" style={{ padding:'4px 2px' }}><Icon name="info" size={15}/>{lang==='es'?'Prueba: abre un pedido en Pedidos y avánzalo a “Listo” — la plantilla se enviará sola al chat.':'Try it: open an order in Pedidos and advance it to “Ready” — the template will be sent to the chat automatically.'}</div>
      </div>
    </div>
  );
}

Object.assign(window, { AutomationsView, FlowCard, flowTriggerValue, flowActionValue });
