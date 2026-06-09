/* ============================================================
   HIRATICKET — Admin screens (Agents · Canned · Settings)
   ============================================================ */

function roleMeta(role, t) {
  return { admin: { label:t('role_admin'), color:'brand', icon:'shield' }, agent: { label:t('role_agent'), color:'blue', icon:'user' }, viewer: { label:t('role_viewer'), color:'slate', icon:'eye' } }[role];
}

/* ---------- Agents ---------- */
function AgentsView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  return (
    <div className="page">
      <div className="phead">
        <h1>{t('agents_title')}</h1>
        <Pill color="slate" large>{window.HT.AGENTS.length}</Pill>
        <span className="grow" />
        <button className="btn btn-primary" onClick={()=>dispatch({ type:'openModal', modal:{ type:'invite' } })}><Icon name="plus" size={16}/>{t('invite_agent')}</button>
      </div>
      <div className="page-pad scroll">
        <div className="tablewrap scroll" style={{ margin:0 }}>
          <table className="tbl" style={{ minWidth:840 }}>
            <thead><tr>
              <th>{t('col_assignee')}</th><th>{t('role')}</th><th>{t('col_area')}</th><th>{state.lang==='es'?'Estado':'Status'}</th>
              <th>{t('open_chats')}</th><th>{t('open_orders')}</th><th style={{ width:60 }}></th>
            </tr></thead>
            <tbody>
              {window.HT.AGENTS.map(a => { const rm = roleMeta(a.role, t); return (
                <tr key={a.id} style={{ cursor:'default' }}>
                  <td><div className="cust"><Avatar agent={a} size={34}/><div style={{ minWidth:0, lineHeight:1.3 }}><div style={{ fontWeight:700, whiteSpace:'nowrap' }}>{a.name}</div><div className="t-xs muted" style={{ whiteSpace:'nowrap' }}>{a.email}</div></div></div></td>
                  <td><Pill color={rm.color}><Icon name={rm.icon} size={12}/>{rm.label}</Pill></td>
                  <td>{a.area ? <AreaTag area={a.area} /> : <span className="muted t-sm">—</span>}</td>
                  <td><span className="row gap-2"><span className={'av-presence '+a.presence} style={{ position:'static', border:'none', width:9, height:9 }}/><span className="t-sm">{t(a.presence)}</span></span></td>
                  <td><span className="mono" style={{ fontWeight:700 }}>{a.openChats}</span></td>
                  <td><span className="mono" style={{ fontWeight:700 }}>{a.openOrders}</span></td>
                  <td><Popover align="right" trigger={(o,tog)=><button className="iconbtn sm" onClick={tog}><Icon name="dots" size={16}/></button>}>
                    {(close)=>(<div><button className="menu-item" onClick={close}><Icon name="edit" size={16}/>{t('edit_perms')}</button><button className="menu-item" onClick={close}><Icon name="mail" size={16}/>{lang==='es'?'Reenviar invitación':'Resend invite'}</button><div className="menu-sep"/><button className="menu-item danger" onClick={close}><Icon name="trash" size={16}/>{t('deactivate')}</button></div>)}
                  </Popover></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- Canned messages ---------- */
function CannedView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const cats = {}; window.HT.CANNED.forEach(k => { (cats[k.category]=cats[k.category]||[]).push(k); });
  return (
    <div className="page">
      <div className="phead">
        <h1>{t('canned_title')}</h1>
        <Pill color="slate" large>{window.HT.CANNED.length}</Pill>
        <span className="grow" />
        <button className="btn btn-primary" onClick={()=>dispatch({ type:'openModal', modal:{ type:'cannedEdit' } })}><Icon name="plus" size={16}/>{t('new_template')}</button>
      </div>
      <div className="page-pad scroll">
        <div className="card card-pad" style={{ marginBottom:16, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span className="shead">{t('variables')}</span>
          {window.HT.CANNED_VARS.map(v => <VarChip key={v}>{'{{'+v+'}}'}</VarChip>)}
          <span className="t-sm muted">· {lang==='es'?'se reemplazan automáticamente al insertar':'auto-filled on insert'}</span>
        </div>
        {Object.keys(cats).map(cat => (
          <div key={cat} style={{ marginBottom:22 }}>
            <div className="shead" style={{ marginBottom:10 }}>{t(cat)} <span className="badge badge-soft">{cats[cat].length}</span></div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:12 }}>
              {cats[cat].map(k => (
                <div key={k.id} className="card card-pad card-hover">
                  <div className="row gap-2" style={{ marginBottom:8 }}>
                    <span style={{ fontWeight:700, fontSize:14 }}>{window.L(k.title, lang)}</span>
                    <span className="grow" />
                    <span className="mono pill pill-slate">{k.shortcut}</span>
                    <Popover align="right" trigger={(o,tog)=><button className="iconbtn sm" onClick={tog}><Icon name="dots" size={15}/></button>}>
                      {(close)=>(<div><button className="menu-item" onClick={()=>{ dispatch({ type:'openModal', modal:{ type:'cannedEdit', id:k.id } }); close(); }}><Icon name="edit" size={16}/>{lang==='es'?'Editar':'Edit'}</button><button className="menu-item danger" onClick={close}><Icon name="trash" size={16}/>{lang==='es'?'Eliminar':'Delete'}</button></div>)}
                    </Popover>
                  </div>
                  <div className="t-sm" style={{ color:'var(--text-muted)', lineHeight:1.5 }}>{renderTemplate(window.L(k.body, lang))}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Settings ---------- */
function SettingsView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const connOk = state.connection === 'connected';
  const numbers = [
    { label:'Hirata · Ventas', phone:'+52 55 1000 2030', status:state.connection, primary:true },
    { label:'Hirata · Soporte', phone:'+52 55 1000 4050', status:'connected', primary:false },
  ];
  const brands = ['#F5C518', '#0D9488', '#4F46E5', '#EA580C'];
  return (
    <div className="page">
      <div className="phead"><h1>{t('settings_title')}</h1></div>
      <div className="page-pad scroll" style={{ maxWidth:760 }}>

        {/* connection */}
        <div className="card" style={{ marginBottom:18 }}>
          <div className="ws-block-head" style={{ padding:'14px 16px' }}><Icon name="whatsapp" size={18}/><h4 style={{ fontSize:14 }} className="grow">{t('set_connection')}</h4>
            <button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'openModal', modal:{ type:'qr' } })}><Icon name="plus" size={14}/>{t('add_number')}</button>
          </div>
          <div style={{ padding:16, display:'flex', flexDirection:'column', gap:10 }}>
            {numbers.map((n, i) => { const ok = n.status==='connected'; return (
              <div key={i} className="row gap-3" style={{ padding:'12px 14px', border:'1px solid var(--border)', borderRadius:'var(--r-md)', background:'var(--surface)' }}>
                <span className="t-ic" style={{ width:40, height:40, borderRadius:11, background: ok?'var(--green-bg)':'var(--red-bg)', color: ok?'var(--green)':'var(--red)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name={ok?'wifi':'wifioff'}/></span>
                <div className="grow" style={{ minWidth:0 }}><div style={{ fontWeight:700 }}>{n.label}{n.primary && <span className="pill pill-brand" style={{ marginLeft:8, height:18 }}>{lang==='es'?'Principal':'Primary'}</span>}</div><div className="mono t-sm muted">{n.phone}</div></div>
                {ok ? <Pill color="green" dot>{t('connected')}</Pill> : <button className="btn btn-sm btn-primary" onClick={()=>dispatch({ type:'openModal', modal:{ type:'qr' } })}><Icon name="qr" size={14}/>{t('reconnect')}</button>}
              </div>
            ); })}
            <div className="t-sm muted row gap-2"><Icon name="info" size={15}/>{lang==='es'?'La conexión usa WhatsApp Web; mantén el teléfono del negocio con internet.':'Connection uses WhatsApp Web; keep the business phone online.'}</div>
          </div>
        </div>

        {/* areas */}
        <div className="card card-pad" style={{ marginBottom:18, display:'flex', alignItems:'center', gap:12 }}>
          <span className="t-ic" style={{ width:40, height:40, borderRadius:11, background:'var(--surface-2)', color:'var(--text-muted)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="layers"/></span>
          <div className="grow"><div style={{ fontWeight:700, fontSize:14 }}>{t('set_areas')}</div><div className="t-sm muted">{lang==='es'?'Las áreas y su ruteo por defecto ahora se configuran en Negocio.':'Areas and their default routing are now configured in Business.'}</div></div>
          <button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'navigate', route:'business' })}>{t('nav_business')}<Icon name="arrowr" size={14}/></button>
        </div>

        {/* appearance */}
        <div className="card">
          <div className="ws-block-head" style={{ padding:'14px 16px' }}><Icon name="sun" size={18}/><h4 style={{ fontSize:14 }}>{t('set_appearance')}</h4></div>
          <div style={{ padding:16, display:'flex', flexDirection:'column', gap:16 }}>
            <div className="row gap-3"><span style={{ fontWeight:600, width:140 }}>{t('theme')}</span>
              <div className="seg">
                <button className={state.theme==='light'?'on':''} onClick={()=>dispatch({ type:'setTheme', theme:'light' })}><Icon name="sun" size={14}/>{t('light')}</button>
                <button className={state.theme==='dark'?'on':''} onClick={()=>dispatch({ type:'setTheme', theme:'dark' })}><Icon name="moon" size={14}/>{t('dark')}</button>
              </div>
            </div>
            <div className="row gap-3"><span style={{ fontWeight:600, width:140 }}>{t('language')}</span>
              <div className="seg">
                <button className={state.lang==='es'?'on':''} onClick={()=>dispatch({ type:'setLang', lang:'es' })}>Español</button>
                <button className={state.lang==='en'?'on':''} onClick={()=>dispatch({ type:'setLang', lang:'en' })}>English</button>
              </div>
            </div>
            <div className="row gap-3"><span style={{ fontWeight:600, width:140 }}>{lang==='es'?'Densidad':'Density'}</span>
              <div className="seg">
                <button className={state.density==='comfortable'?'on':''} onClick={()=>dispatch({ type:'setDensity', density:'comfortable' })}>{t('comfortable')}</button>
                <button className={state.density==='compact'?'on':''} onClick={()=>dispatch({ type:'setDensity', density:'compact' })}>{t('compact')}</button>
              </div>
            </div>
            <div className="row gap-3"><span style={{ fontWeight:600, width:140 }}>{lang==='es'?'Color de marca':'Brand color'}</span>
              <div className="row gap-2">
                {brands.map(b => <button key={b} onClick={()=>dispatch({ type:'setBrand', brand:b })} style={{ width:30, height:30, borderRadius:9, background:b, border: state.brand===b?'2px solid var(--text)':'2px solid var(--border)', cursor:'pointer', boxShadow: state.brand===b?'0 0 0 3px var(--surface), 0 0 0 4px '+b:'none' }} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AgentsView, CannedView, SettingsView });
