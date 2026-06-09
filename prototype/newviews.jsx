/* ============================================================
   HIRATICKET — Catalog · Agenda · Campaigns · Reports · Business
   ============================================================ */

/* ---------- Catalog ---------- */
function CatalogView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [q, setQ] = useState('');
  const rows = window.HT.CATALOG.filter(p => !q || window.L(p.name,lang).toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="phead"><h1>{t('catalog_title')}</h1><Pill color="slate" large>{rows.length}</Pill><span className="grow" />
        <button className="btn btn-primary" onClick={()=>dispatch({ type:'toast', toast:{ icon:'plus', title:t('new_item') } })}><Icon name="plus" size={16}/>{t('new_item')}</button>
      </div>
      <div className="toolbar"><div className="field field-sm" style={{ width:260 }}><Icon name="search"/><input placeholder={t('search_ph')} value={q} onChange={e=>setQ(e.target.value)}/></div></div>
      <div className="tablewrap scroll">
        <table className="tbl" style={{ minWidth:720 }}>
          <thead><tr><th>{lang==='es'?'Artículo':'Item'}</th><th>{t('col_sku')}</th><th>{t('col_category')}</th><th>{t('col_price')}</th><th></th></tr></thead>
          <tbody>
            {rows.map(p=>(
              <tr key={p.id} style={{ cursor:'default' }}>
                <td><div className="cust"><span className="lineitem-thumb" style={{ width:32, height:32 }} /><span style={{ fontWeight:600 }}>{window.L(p.name, lang)}</span></div></td>
                <td><span className="mono t-sm muted">{p.sku}</span></td>
                <td><Pill color="slate">{window.L(p.category, lang)}</Pill></td>
                <td><span className="mono" style={{ fontWeight:700 }}>{window.HT.money(p.price)}</span> <span className="t-xs muted">/ {window.L(p.unit, lang)}</span></td>
                <td><button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'openModal', modal:{ type:'newOrder' } })}><Icon name="plus" size={13}/>{lang==='es'?'A pedido':'To order'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Agenda ---------- */
function AgendaView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const stMeta = { confirmed:{ c:'green', k:'appt_confirmed' }, pending:{ c:'amber', k:'appt_pending' }, done:{ c:'slate', k:'appt_done' } };
  const Day = ({ day, label }) => {
    const list = state.appointments.filter(a=>a.day===day);
    return (
      <div className="pcard" style={{ marginBottom:14 }}>
        <div className="pcard-head"><Icon name="calendar" size={16}/><h3 className="grow">{label}</h3><Pill color="slate">{list.length}</Pill></div>
        <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:8, padding:'10px 12px' }}>
          {list.length===0 ? <div className="muted t-sm" style={{ padding:6 }}>{lang==='es'?'Sin citas':'No appointments'}</div> :
            list.map(ap=>{ const c=window.HT.contactById(ap.contactId); const ag=window.HT.agentById(ap.agent); const sm=stMeta[ap.status]; return (
              <div key={ap.id} className="row gap-3" style={{ padding:'10px 12px', border:'1px solid var(--border)', borderRadius:'var(--r-md)' }}>
                <div style={{ width:54, flex:'none', textAlign:'center' }}><div className="mono" style={{ fontWeight:800, fontSize:15 }}>{ap.time}</div></div>
                <div className="vr" style={{ alignSelf:'stretch' }} />
                <Avatar contact={c} size={32}/>
                <div className="grow" style={{ minWidth:0 }}><div style={{ fontWeight:700 }} className="truncate">{window.L(ap.title, lang)}</div><div className="t-xs muted">{c.name}</div></div>
                <AreaTag area={ap.area} />
                {ag && <Avatar agent={ag} size={24}/>}
                <Pill color={sm.c} dot>{t(sm.k)}</Pill>
              </div>
            ); })}
        </div>
      </div>
    );
  };
  return (
    <div className="page">
      <div className="phead"><h1>{t('agenda_title')}</h1><span className="grow" /><button className="btn btn-primary" onClick={()=>dispatch({ type:'toast', toast:{ icon:'calendar', tone:'blue', title:t('new_appt') } })}><Icon name="plus" size={16}/>{t('new_appt')}</button></div>
      <div className="page-pad scroll" style={{ maxWidth:760 }}>
        <Day day="today" label={t('appt_today')} />
        <Day day="tomorrow" label={t('appt_tomorrow')} />
      </div>
    </div>
  );
}

/* ---------- Campaigns ---------- */
function CampaignsView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [tpl, setTpl] = useState('k1'); const [seg, setSeg] = useState('all');
  const segCount = seg==='all' ? window.HT.CONTACTS.length : window.HT.CONTACTS.filter(c=>c.tags.includes(seg)).length;
  const segs = ['all','Mayoreo','Negocio','Recurrente'];
  const stMeta = { sent:{ c:'green', k:'sent_label' }, scheduled:{ c:'amber', k:'scheduled_label' }, draft:{ c:'slate', k:'draft_label' } };
  return (
    <div className="page">
      <div className="phead"><h1>{t('campaigns_title')}</h1></div>
      <div className="page-pad scroll" style={{ maxWidth:840, display:'flex', flexDirection:'column', gap:16 }}>
        <div className="pcard">
          <div className="pcard-head"><Icon name="send" size={16}/><h3>{t('new_campaign')}</h3></div>
          <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="row gap-3">
              <div className="grow"><label className="lbl">{t('choose_template')}</label><select className="field" style={{ width:'100%' }} value={tpl} onChange={e=>setTpl(e.target.value)}>{window.HT.CANNED.map(k=><option key={k.id} value={k.id}>{window.L(k.title, lang)}</option>)}</select></div>
              <div className="grow"><label className="lbl">{t('segment')}</label><select className="field" style={{ width:'100%' }} value={seg} onChange={e=>setSeg(e.target.value)}>{segs.map(s=><option key={s} value={s}>{s==='all'?t('seg_all'):s}</option>)}</select></div>
            </div>
            <div className="msg out" style={{ maxWidth:'100%' }}><div className="bubble" style={{ borderBottomRightRadius:16 }}>{renderTemplate(window.L(window.HT.cannedById(tpl).body, lang))}</div></div>
            <div className="row gap-3"><span className="t-sm muted grow"><Icon name="agents" size={14}/> <strong style={{ color:'var(--text)' }}>{segCount}</strong> {t('recipients')}</span>
              <button className="btn btn-primary" onClick={()=>dispatch({ type:'sendCampaign', sub:`${segCount} ${t('recipients')}` })}><Icon name="send" size={15}/>{t('send_now')}</button>
            </div>
          </div>
        </div>
        <div className="shead">{lang==='es'?'Historial':'History'}</div>
        {state.campaigns.map(cmp=>{ const sm=stMeta[cmp.status]; return (
          <div key={cmp.id} className="card card-pad row gap-3" style={{ alignItems:'center' }}>
            <span className="t-ic" style={{ width:40, height:40, borderRadius:11, background:'var(--brand-50)', color:'var(--brand-700)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="send"/></span>
            <div className="grow" style={{ minWidth:0 }}><div style={{ fontWeight:700 }}>{window.L(cmp.name, lang)}</div><div className="t-xs muted">{cmp.segment==='all'?t('seg_all'):cmp.segment} · {cmp.recipients} {t('recipients')} · {window.L(cmp.date, lang)}</div></div>
            {cmp.status==='sent' && <div className="row gap-3" style={{ marginRight:8 }}><div style={{ textAlign:'right' }}><div className="mono" style={{ fontWeight:700 }}>{cmp.delivered}%</div><div className="t-xs muted">{t('delivered_rate')}</div></div><div style={{ textAlign:'right' }}><div className="mono" style={{ fontWeight:700 }}>{cmp.read}%</div><div className="t-xs muted">{t('read_rate')}</div></div></div>}
            <Pill color={sm.c} dot>{t(sm.k)}</Pill>
          </div>
        ); })}
      </div>
    </div>
  );
}

/* ---------- Reports ---------- */
function ReportsView() {
  const { state } = useApp(); const t = useT(); const lang = state.lang;
  const orders = state.orders;
  const sales = orders.reduce((s,o)=>s+o.total,0);
  const resolved = state.conversations.filter(c=>c.status==='resolved').length;
  const trend = [4200, 5100, 3800, 6400, 5800, 7200, 6100]; const maxT = Math.max(...trend);
  const byStage = state.config.stages.map(s=>({ id:s.id, color:s.color, name:window.L(s.name, lang), n:orders.filter(o=>o.status===s.id).length }));
  const byArea = state.config.areas.map(a=>({ id:a.id, color:a.color, name:window.L(a.name, lang), n:orders.filter(o=>o.area===a.id).length }));
  const maxStage = Math.max(...byStage.map(x=>x.n),1); const maxArea = Math.max(...byArea.map(x=>x.n),1);
  const topAgents = window.HT.AGENTS.filter(a=>a.role!=='viewer').slice().sort((a,b)=>b.openOrders-a.openOrders).slice(0,4);
  return (
    <div className="page">
      <div className="phead"><h1>{t('reports_title')}</h1></div>
      <div className="page-pad scroll" style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <div className="kpi-grid">
          <div className="kpi"><div className="kpi-head"><span className="ic"><Icon name="orders" size={16}/></span>{t('rep_sales')}</div><div className="kpi-val">{window.HT.money(sales)} <span className="unit">MXN</span></div></div>
          <div className="kpi"><div className="kpi-head"><span className="ic"><Icon name="orders" size={16}/></span>{t('rep_orders')}</div><div className="kpi-val">{orders.length}</div></div>
          <div className="kpi"><div className="kpi-head"><span className="ic"><Icon name="clock" size={16}/></span>{t('rep_resp')}</div><div className="kpi-val">8 <span className="unit">min</span></div></div>
          <div className="kpi"><div className="kpi-head"><span className="ic"><Icon name="check" size={16}/></span>{t('rep_resolved')}</div><div className="kpi-val">{resolved}</div></div>
        </div>
        <div className="two-col">
          <div className="pcard"><div className="pcard-head"><Icon name="orders" size={16}/><h3>{t('rep_sales_trend')}</h3></div>
            <div className="pcard-body"><div className="chart">{trend.map((v,i)=>(<div className="chart-col" key={i}><div className="chart-bar" style={{ height:(v/maxT*100)+'%' }} /><span className="chart-lbl">{['L','M','M','J','V','S','D'][i]}</span></div>))}</div></div>
          </div>
          <div className="pcard"><div className="pcard-head"><Icon name="status" size={16}/><h3>{t('rep_by_stage')}</h3></div>
            <div className="pcard-body"><div className="distro">{byStage.map(s=>(<div className="distro-row" key={s.id}><span style={{ fontWeight:600 }} className="truncate">{s.name}</span><div className="distro-track"><div className="distro-fill" style={{ width:(s.n/maxStage*100)+'%', background:'var(--'+s.color+')' }}/></div><span className="mono" style={{ textAlign:'right', fontWeight:700 }}>{s.n}</span></div>))}</div></div>
          </div>
        </div>
        <div className="two-col">
          <div className="pcard"><div className="pcard-head"><Icon name="layers" size={16}/><h3>{t('rep_by_area')}</h3></div>
            <div className="pcard-body"><div className="distro">{byArea.map(s=>(<div className="distro-row" key={s.id}><span style={{ fontWeight:600 }} className="truncate">{s.name}</span><div className="distro-track"><div className="distro-fill" style={{ width:(s.n/maxArea*100)+'%', background:'var(--'+s.color+')' }}/></div><span className="mono" style={{ textAlign:'right', fontWeight:700 }}>{s.n}</span></div>))}</div></div>
          </div>
          <div className="pcard"><div className="pcard-head"><Icon name="agents" size={16}/><h3>{t('rep_by_agent')}</h3></div>
            <div className="pcard-body" style={{ padding:'6px 8px' }}>{topAgents.map(a=>(<div key={a.id} className="row gap-3" style={{ padding:'8px 8px' }}><Avatar agent={a} size={30}/><span className="grow" style={{ fontWeight:600 }}>{a.name}</span><span className="mono" style={{ fontWeight:700 }}>{a.openOrders}</span><span className="t-xs muted">{t('rep_orders').toLowerCase()}</span></div>))}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Business config ---------- */
const CFG_PALETTE = ['slate','blue','violet','teal','green','amber','red','brand'];
function ColorDot({ color, onPick }) {
  return (
    <Popover trigger={(o,tog)=><button className="iconbtn sm" onClick={tog} style={{ width:24, height:24, flex:'none' }}><span className="dot" style={{ width:13, height:13, borderRadius:9, background:'var(--'+color+')', display:'inline-block' }}/></button>}>
      {(close)=>(<div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, padding:4 }}>{CFG_PALETTE.map(c=>(<button key={c} className="iconbtn sm" onClick={()=>{ onPick(c); close(); }} style={{ width:28, height:28 }}><span className="dot" style={{ width:16, height:16, borderRadius:9, background:'var(--'+c+')', display:'inline-block', boxShadow: c===color?'0 0 0 2px var(--text)':'none' }}/></button>))}</div>)}
    </Popover>
  );
}
function BusinessView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const cfg = state.config;
  const [field, setField] = useState('');
  const [newStage, setNewStage] = useState('');
  const [newArea, setNewArea] = useState('');
  return (
    <div className="page">
      <div className="phead"><div><h1>{t('biz_config')}</h1><div className="sub">{t('biz_vertical_sub')}</div></div></div>
      <div className="page-pad scroll" style={{ maxWidth:820, display:'flex', flexDirection:'column', gap:16 }}>
        {/* vertical */}
        <div className="pcard"><div className="pcard-head"><Icon name="store" size={17}/><h3>{t('biz_vertical')}</h3></div>
          <div className="pcard-body"><div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {window.HT.VERTICALS.map(v=>(
              <button key={v.id} className={'radio-card'+(cfg.verticalId===v.id?' on':'')} onClick={()=>dispatch({ type:'setVertical', id:v.id })} style={{ flexDirection:'column', alignItems:'flex-start', gap:8 }}>
                <span className="t-ic" style={{ width:34, height:34, borderRadius:10, background:'var(--brand-50)', color:'var(--brand-700)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name={v.icon} size={18}/></span>
                <div style={{ textAlign:'left' }}><div style={{ fontWeight:700, fontSize:13.5 }}>{window.L(v.name, lang)}</div><div className="t-xs muted">{window.L(v.object, lang)}</div></div>
              </button>
            ))}
          </div></div>
        </div>
        {/* object name */}
        <div className="pcard"><div className="pcard-head"><Icon name="orders" size={17}/><h3>{t('biz_object')}</h3></div>
          <div className="pcard-body row gap-3"><input className="field" style={{ maxWidth:280 }} value={window.L(cfg.object, lang)} onChange={e=>dispatch({ type:'setObjectName', value:e.target.value })} /><span className="t-sm muted">{lang==='es'?'Así se llamará en el menú y encabezados.':'Used in the menu and headers.'}</span></div>
        </div>
        {/* stages */}
        <div className="pcard"><div className="pcard-head"><Icon name="status" size={17}/><h3 className="grow">{t('biz_stages')}</h3><span className="t-xs muted">{t('biz_stages_sub')}</span></div>
          <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {cfg.stages.map(s=>(
              <div key={s.id} className="row gap-2"><ColorDot color={s.color} onPick={(c)=>dispatch({ type:'setStageColor', id:s.id, color:c })} /><input className="field field-sm grow" value={window.L(s.name, lang)} onChange={e=>dispatch({ type:'setStageName', id:s.id, value:e.target.value })} />{cfg.stages.length>2 && <button className="iconbtn sm" onClick={()=>dispatch({ type:'removeStage', id:s.id })}><Icon name="trash" size={15}/></button>}</div>
            ))}
            <div className="row gap-2" style={{ marginTop:2 }}><input className="field field-sm grow" placeholder={lang==='es'?'Nombre de la etapa…':'Stage name…'} value={newStage} onChange={e=>setNewStage(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&newStage.trim()){ dispatch({ type:'addStage', value:newStage.trim() }); setNewStage(''); } }} /><button className="btn btn-sm btn-outline" onClick={()=>{ if(newStage.trim()){ dispatch({ type:'addStage', value:newStage.trim() }); setNewStage(''); } }}><Icon name="plus" size={13}/>{t('add_stage')}</button></div>
          </div>
        </div>
        {/* areas */}
        <div className="pcard"><div className="pcard-head"><Icon name="layers" size={17}/><h3 className="grow">{t('biz_areas')}</h3><span className="t-xs muted">{t('default_routing')}</span></div>
          <div className="pcard-body" style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {cfg.areas.map(ar=>(
              <div key={ar.id} className="row gap-2"><ColorDot color={ar.color} onPick={(c)=>dispatch({ type:'setAreaColor', id:ar.id, color:c })} /><input className="field field-sm grow" style={{ minWidth:90 }} value={window.L(ar.name, lang)} onChange={e=>dispatch({ type:'setAreaName', id:ar.id, value:e.target.value })} /><select className="field field-sm" style={{ width:150, flex:'none' }} value={ar.routeTo || ((window.HT.AGENTS.find(g=>g.area===ar.id)||{}).id) || ''} onChange={e=>dispatch({ type:'setAreaRoute', id:ar.id, agent:e.target.value||null })}><option value="">{lang==='es'?'Sin asignar':'Unassigned'}</option>{window.HT.AGENTS.filter(g=>g.role!=='viewer').map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>{cfg.areas.length>1 && <button className="iconbtn sm" onClick={()=>dispatch({ type:'removeArea', id:ar.id })}><Icon name="trash" size={15}/></button>}</div>
            ))}
            <div className="row gap-2" style={{ marginTop:2 }}><input className="field field-sm grow" placeholder={lang==='es'?'Nombre del área…':'Area name…'} value={newArea} onChange={e=>setNewArea(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&newArea.trim()){ dispatch({ type:'addArea', value:newArea.trim() }); setNewArea(''); } }} /><button className="btn btn-sm btn-outline" onClick={()=>{ if(newArea.trim()){ dispatch({ type:'addArea', value:newArea.trim() }); setNewArea(''); } }}><Icon name="plus" size={13}/>{lang==='es'?'Agregar área':'Add area'}</button></div>
          </div>
        </div>
        {/* custom fields */}
        <div className="pcard"><div className="pcard-head"><Icon name="sliders" size={17}/><h3 className="grow">{t('biz_fields')}</h3><span className="t-xs muted">{t('biz_fields_sub')}</span></div>
          <div className="pcard-body">
            <div className="row gap-2" style={{ flexWrap:'wrap', marginBottom:12 }}>
              {cfg.fields.map((f,i)=>(<span key={i} className="pill pill-slate" style={{ height:28, paddingRight:6 }}>{window.L(f, lang)}<button className="iconbtn sm" style={{ width:18, height:18 }} onClick={()=>dispatch({ type:'removeField', index:i })}><Icon name="x" size={12}/></button></span>))}
              {cfg.fields.length===0 && <span className="t-sm muted">{lang==='es'?'Sin campos':'No fields'}</span>}
            </div>
            <div className="row gap-2"><input className="field field-sm" style={{ maxWidth:240 }} placeholder={lang==='es'?'p. ej. Placa, Mascota…':'e.g. Plate, Pet…'} value={field} onChange={e=>setField(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&field.trim()){ dispatch({ type:'addField', value:field.trim() }); setField(''); } }} /><button className="btn btn-sm btn-outline" onClick={()=>{ if(field.trim()){ dispatch({ type:'addField', value:field.trim() }); setField(''); } }}><Icon name="plus" size={13}/>{t('add_field')}</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CatalogView, AgendaView, CampaignsView, ReportsView, BusinessView });
