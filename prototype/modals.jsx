/* ============================================================
   HIRATICKET — Modals
   ============================================================ */

/* ---------- Faux QR (CSS grid of cells) ---------- */
function FauxQR({ seed = 7 }) {
  const N = 21;
  const cells = useMemo(() => {
    let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const grid = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const finder = (x < 7 && y < 7) || (x >= N-7 && y < 7) || (x < 7 && y >= N-7);
      grid.push(finder ? null : rnd() > 0.5);
    }
    return grid;
  }, [seed]);
  const Finder = ({ s }) => (<div style={{ position:'absolute', ...s, width:'30%', height:'30%' }}><div style={{ width:'100%', height:'100%', border:'3px solid #111', borderRadius:4, padding:3 }}><div style={{ width:'100%', height:'100%', background:'#111', borderRadius:2 }}/></div></div>);
  return (
    <div style={{ position:'relative', width:200, height:200, background:'#fff', borderRadius:12, padding:10, boxShadow:'var(--sh-sm)' }}>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${N},1fr)`, width:'100%', height:'100%', gap:0 }}>
        {cells.map((c, i) => <div key={i} style={{ background: c ? '#111' : 'transparent' }} />)}
      </div>
      <Finder s={{ left:10, top:10 }} /><Finder s={{ right:10, top:10 }} /><Finder s={{ left:10, bottom:10 }} />
    </div>
  );
}

/* ---------- Transfer dialog ---------- */
function TransferModal({ target }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [mode, setMode] = useState('agent');
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState('');
  const close = () => dispatch({ type:'closeModal' });
  const label = target.kind === 'orders' ? `${target.ids.length} ${t('of_orders')}` : target.kind === 'order' ? state.orders.find(o=>o.id===target.id).code : window.HT.contactById(state.conversations.find(c=>c.id===target.id).contactId).name;

  const confirm = () => {
    const destName = mode === 'agent' ? window.HT.agentById(pick).name : window.L(window.HT.areaById(pick).name, lang);
    dispatch({ type:'transfer', target, mode, dest:pick, note, destName });
    close();
  };
  return (
    <Modal title={t('transfer_title')} icon="swap" onClose={close}
      foot={<><button className="btn btn-ghost grow" onClick={close}>{t('cancel')}</button><button className="btn btn-primary grow" disabled={!pick} onClick={confirm}><Icon name="swap" size={15}/>{t('confirm_transfer')}</button></>}>
      <div style={{ paddingBottom:16, display:'flex', flexDirection:'column', gap:16 }}>
        <div className="row gap-2 t-sm muted"><Icon name={target.kind==='conversation'?'chat':'orders'} size={15}/>{lang==='es'?'Transfiriendo':'Transferring'} <strong style={{ color:'var(--text)' }}>{label}</strong></div>
        <div>
          <label className="lbl">{t('transfer_to')}</label>
          <div className="seg" style={{ width:'100%' }}>
            <button className={mode==='agent'?'on':''} style={{ flex:1, justifyContent:'center' }} onClick={()=>{ setMode('agent'); setPick(null); }}><Icon name="user" size={14}/>{t('to_agent')}</button>
            <button className={mode==='area'?'on':''} style={{ flex:1, justifyContent:'center' }} onClick={()=>{ setMode('area'); setPick(null); }}><Icon name="layers" size={14}/>{t('to_area')}</button>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:7, maxHeight:240, overflowY:'auto' }} className="scroll">
          {mode === 'agent'
            ? window.HT.AGENTS.filter(a=>a.role!=='viewer').map(a => (
                <button key={a.id} className={'radio-card'+(pick===a.id?' on':'')} onClick={()=>setPick(a.id)}>
                  <Avatar agent={a} size={34}/><div className="grow" style={{ textAlign:'left' }}><div style={{ fontWeight:700 }}>{a.name}</div><div className="t-xs muted">{a.area?window.L(window.HT.areaById(a.area).name,lang):''} · {a.openChats} {t('open_chats').toLowerCase()}</div></div><span className="radio-dot"/>
                </button>
              ))
            : window.HT.AREAS.map(a => (
                <button key={a.id} className={'radio-card'+(pick===a.id?' on':'')} onClick={()=>setPick(a.id)}>
                  <span className="dot" style={{ width:14, height:14, borderRadius:9, background:'var(--'+a.color+')' }}/><div className="grow" style={{ textAlign:'left' }}><div style={{ fontWeight:700 }}>{window.L(a.name,lang)}</div></div><span className="radio-dot"/>
                </button>
              ))}
        </div>
        <div>
          <label className="lbl">{t('transfer_note')}</label>
          <div className="field" style={{ height:'auto', alignItems:'flex-start', padding:'9px 11px' }}><textarea className="bare" rows={2} placeholder={t('transfer_note_ph')} value={note} onChange={e=>setNote(e.target.value)} style={{ fontSize:13 }}/></div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- New order ---------- */
function NewOrderModal({ contactId }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [cid, setCid] = useState(contactId || state.conversations.find(c=>c.id===state.selectedConvId)?.contactId || 'c1');
  const [area, setArea] = useState('ventas');
  const [priority, setPriority] = useState('med');
  const [item, setItem] = useState(''); const [qty, setQty] = useState(1); const [price, setPrice] = useState('');
  const close = () => dispatch({ type:'closeModal' });
  const total = (Number(qty)||0) * (Number(price)||0);
  const create = () => { dispatch({ type:'createOrder', contactId:cid, area, priority, item: item || (lang==='es'?'Pedido nuevo':'New order'), qty:Number(qty)||1, price:Number(price)||0 }); close(); };
  return (
    <Modal title={t('new_order')} icon="orders" onClose={close} wide
      foot={<><button className="btn btn-ghost grow" onClick={close}>{t('cancel')}</button><button className="btn btn-primary grow" onClick={create}><Icon name="plus" size={15}/>{t('create')}</button></>}>
      <div style={{ paddingBottom:16, display:'flex', flexDirection:'column', gap:14 }}>
        <div><label className="lbl">{t('col_customer')}</label>
          <select className="field" style={{ width:'100%' }} value={cid} onChange={e=>setCid(e.target.value)}>{window.HT.CONTACTS.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select>
        </div>
        <div className="row gap-3">
          <div className="grow"><label className="lbl">{t('col_area')}</label><select className="field" style={{ width:'100%' }} value={area} onChange={e=>setArea(e.target.value)}>{window.HT.AREAS.map(a=><option key={a.id} value={a.id}>{window.L(a.name,lang)}</option>)}</select></div>
          <div className="grow"><label className="lbl">{t('col_priority')}</label><select className="field" style={{ width:'100%' }} value={priority} onChange={e=>setPriority(e.target.value)}>{Object.keys(window.HT.PRIORITY).map(p=><option key={p} value={p}>{t(window.HT.PRIORITY[p].key)}</option>)}</select></div>
        </div>
        <div><label className="lbl">{t('line_items')}</label>
          <div className="card card-pad" style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <select className="field" style={{ width:'100%' }} value="" onChange={e=>{ const p=window.HT.CATALOG.find(x=>x.id===e.target.value); if(p){ setItem(window.L(p.name,lang)); setPrice(p.price); } }}>
              <option value="">{t('add_from_catalog')}…</option>
              {window.HT.CATALOG.map(p=><option key={p.id} value={p.id}>{window.L(p.name,lang)} — {window.HT.money(p.price)}</option>)}
            </select>
            <div className="field"><Icon name="orders"/><input placeholder={lang==='es'?'p. ej. 500 stickers troquelados 5×5cm':'e.g. 500 die-cut stickers 5×5cm'} value={item} onChange={e=>setItem(e.target.value)}/></div>
            <div className="row gap-3">
              <div style={{ width:110 }}><label className="lbl">{t('qty')}</label><input className="field" style={{ width:'100%' }} type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)}/></div>
              <div className="grow"><label className="lbl">{lang==='es'?'Precio unitario':'Unit price'}</label><div className="field"><span className="muted">$</span><input type="number" placeholder="0.00" value={price} onChange={e=>setPrice(e.target.value)}/><span className="muted t-sm">MXN</span></div></div>
              <div style={{ alignSelf:'flex-end', paddingBottom:8 }}><span className="muted t-sm">{t('subtotal')}: </span><span className="mono" style={{ fontWeight:800 }}>{window.HT.money(total)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- QR connect ---------- */
function QRModal() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [seed, setSeed] = useState(7);
  const close = () => dispatch({ type:'closeModal' });
  return (
    <Modal title={t('qr_title')} icon="qr" onClose={close}>
      <div style={{ paddingBottom:18, display:'flex', flexDirection:'column', alignItems:'center', gap:16, textAlign:'center' }}>
        <p className="muted" style={{ maxWidth:340 }}>{t('qr_sub')}</p>
        <div style={{ position:'relative' }}>
          <FauxQR seed={seed} />
          <div className="row gap-2" style={{ position:'absolute', left:'50%', bottom:-12, transform:'translateX(-50%)', background:'var(--ink)', color:'#fff', padding:'4px 10px', borderRadius:999, fontSize:11.5, fontWeight:600, whiteSpace:'nowrap' }}>
            <span style={{ width:7, height:7, borderRadius:9, background:'var(--brand)', animation:'ht-pulse 1.4s infinite' }}/>{t('qr_waiting')}
          </div>
        </div>
        <div className="row gap-2" style={{ marginTop:8 }}>
          <button className="btn btn-outline" onClick={()=>setSeed(s=>s+3)}><Icon name="refresh" size={15}/>{t('qr_refresh')}</button>
          <button className="btn btn-primary" onClick={()=>{ dispatch({ type:'setConnection', connection:'connected' }); dispatch({ type:'toast', toast:{ icon:'whatsapp', tone:'wa', title:t('toast_reconnected') } }); close(); }}><Icon name="check" size={15}/>{lang==='es'?'Simular escaneo':'Simulate scan'}</button>
        </div>
        <div className="hr" style={{ width:'100%', marginTop:6 }} />
        <div className="row gap-2 t-sm muted"><Icon name="lock" size={14}/>{lang==='es'?'Conexión no oficial vía WhatsApp Web':'Unofficial connection via WhatsApp Web'}</div>
      </div>
    </Modal>
  );
}

/* ---------- Canned edit ---------- */
function CannedEditModal({ id }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const existing = id ? window.HT.CANNED.find(k=>k.id===id) : null;
  const [title, setTitle] = useState(existing ? window.L(existing.title, lang) : '');
  const [shortcut, setShortcut] = useState(existing ? existing.shortcut : '/');
  const [cat, setCat] = useState(existing ? existing.category : 'cat_greetings');
  const [body, setBody] = useState(existing ? window.L(existing.body, lang) : '');
  const taRef = useRef(null);
  const close = () => dispatch({ type:'closeModal' });
  const insertVar = (v) => setBody(b => b + '{{'+v+'}}');
  const save = () => { dispatch({ type:'toast', toast:{ icon:'check', tone:'green', title: id?(lang==='es'?'Plantilla actualizada':'Template updated'):(lang==='es'?'Plantilla creada':'Template created'), sub:title } }); close(); };
  return (
    <Modal title={id ? (lang==='es'?'Editar plantilla':'Edit template') : t('new_template')} icon="canned" onClose={close} wide
      foot={<><button className="btn btn-ghost grow" onClick={close}>{t('cancel')}</button><button className="btn btn-primary grow" onClick={save}><Icon name="check" size={15}/>{t('save')}</button></>}>
      <div style={{ paddingBottom:16, display:'flex', flexDirection:'column', gap:14 }}>
        <div className="row gap-3">
          <div className="grow"><label className="lbl">{lang==='es'?'Título':'Title'}</label><input className="field" style={{ width:'100%' }} value={title} onChange={e=>setTitle(e.target.value)} placeholder={lang==='es'?'Saludo inicial':'Welcome greeting'}/></div>
          <div style={{ width:130 }}><label className="lbl">{t('shortcut')}</label><input className="field mono" style={{ width:'100%' }} value={shortcut} onChange={e=>setShortcut(e.target.value)}/></div>
        </div>
        <div><label className="lbl">{lang==='es'?'Categoría':'Category'}</label><select className="field" style={{ width:'100%' }} value={cat} onChange={e=>setCat(e.target.value)}>{['cat_greetings','cat_quote','cat_shipping','cat_payment','cat_closing'].map(c=><option key={c} value={c}>{t(c)}</option>)}</select></div>
        <div>
          <div className="row gap-2" style={{ marginBottom:6 }}><label className="lbl" style={{ margin:0 }}>{lang==='es'?'Mensaje':'Message'}</label><span className="grow"/>{window.HT.CANNED_VARS.map(v=><button key={v} className="pill pill-brand" style={{ cursor:'pointer' }} onClick={()=>insertVar(v)}>+ {'{{'+v+'}}'}</button>)}</div>
          <div className="field" style={{ height:'auto', alignItems:'flex-start', padding:'10px 12px' }}><textarea ref={taRef} className="bare" rows={4} value={body} onChange={e=>setBody(e.target.value)} placeholder={lang==='es'?'Hola {{name}}! ...':'Hi {{name}}! ...'}/></div>
          <div className="t-xs muted" style={{ marginTop:6 }}>{lang==='es'?'Vista previa:':'Preview:'} <span style={{ color:'var(--text)' }}>{renderTemplate(body || '…')}</span></div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Invite agent ---------- */
function InviteModal() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [email, setEmail] = useState(''); const [role, setRole] = useState('agent'); const [area, setArea] = useState('ventas');
  const close = () => dispatch({ type:'closeModal' });
  const send = () => { dispatch({ type:'toast', toast:{ icon:'mail', tone:'blue', title:lang==='es'?'Invitación enviada':'Invite sent', sub:email } }); close(); };
  return (
    <Modal title={t('invite_agent')} icon="agents" onClose={close}
      foot={<><button className="btn btn-ghost grow" onClick={close}>{t('cancel')}</button><button className="btn btn-primary grow" disabled={!email} onClick={send}><Icon name="mail" size={15}/>{lang==='es'?'Enviar invitación':'Send invite'}</button></>}>
      <div style={{ paddingBottom:16, display:'flex', flexDirection:'column', gap:14 }}>
        <div><label className="lbl">{t('email')}</label><div className="field"><Icon name="mail"/><input type="email" placeholder="nombre@hirata.mx" value={email} onChange={e=>setEmail(e.target.value)}/></div></div>
        <div><label className="lbl">{t('role')}</label>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {['admin','agent','viewer'].map(r => { const rm = roleMeta(r, t); const desc = { admin:lang==='es'?'Gestiona todo: agentes, áreas, conexión.':'Manages everything: agents, areas, connection.', agent:lang==='es'?'Atiende chats y pedidos asignados.':'Handles assigned chats and orders.', viewer:lang==='es'?'Solo lectura (gerentes).':'Read-only (managers).' }[r];
              return (<button key={r} className={'radio-card'+(role===r?' on':'')} onClick={()=>setRole(r)}><span className="t-ic" style={{ width:32, height:32, borderRadius:9, background:'var(--'+rm.color+'-bg, var(--surface-2))', color:'var(--'+rm.color+', var(--text))', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name={rm.icon} size={16}/></span><div className="grow" style={{ textAlign:'left' }}><div style={{ fontWeight:700 }}>{rm.label}</div><div className="t-xs muted">{desc}</div></div><span className="radio-dot"/></button>);
            })}
          </div>
        </div>
        {role !== 'viewer' && <div><label className="lbl">{t('col_area')}</label><select className="field" style={{ width:'100%' }} value={area} onChange={e=>setArea(e.target.value)}>{window.HT.AREAS.map(a=><option key={a.id} value={a.id}>{window.L(a.name,lang)}</option>)}</select></div>}
      </div>
    </Modal>
  );
}

/* ---------- Flow / automation builder ---------- */
function FlowEditModal({ id }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const existing = id ? state.automations.find(w => w.id === id) : null;
  const [name, setName] = useState(existing ? window.L(existing.name, lang) : '');
  const [trgType, setTrgType] = useState(existing ? existing.trigger.type : 'order_status');
  const [trgVal, setTrgVal] = useState(existing ? existing.trigger.value : 'ready');
  const [actType, setActType] = useState(existing ? existing.action.type : 'send_template');
  const [actVal, setActVal] = useState(existing ? (existing.action.template || existing.action.area || existing.action.agent || existing.action.tag || 'k6') : 'k6');
  const close = () => dispatch({ type:'closeModal' });
  const trg = window.HT.triggerById(trgType);
  const act = window.HT.actionById(actType);

  // keep value defaults sensible when type changes
  const onTrgType = (v) => { setTrgType(v); const tt = window.HT.triggerById(v); setTrgVal(tt.param === 'order_status' ? 'ready' : tt.param === 'conv_status' ? 'resolved' : null); };
  const onActType = (v) => { setActType(v); const aa = window.HT.actionById(v); setActVal(aa.param === 'template' ? 'k6' : aa.param === 'area' ? 'diseno' : aa.param === 'agent' ? 'a_die' : aa.param === 'tag' ? 'VIP' : null); };

  const save = () => {
    const action = { type: actType };
    if (act.param === 'template') action.template = actVal;
    else if (act.param === 'area') action.area = actVal;
    else if (act.param === 'agent') action.agent = actVal;
    else if (act.param === 'tag') action.tag = actVal;
    const flow = { id: id || 'w'+Date.now(), name: { en:name||'Automation', es:name||'Flujo' }, enabled: existing ? existing.enabled : true, runs: existing ? existing.runs : 0, trigger: { type: trgType, value: trg.param ? trgVal : null }, action };
    dispatch({ type:'saveAutomation', flow });
    close();
  };

  const ValueSelect = ({ param, value, onChange }) => {
    if (param === 'order_status') return <select className="field" style={{ width:'100%' }} value={value} onChange={e=>onChange(e.target.value)}>{window.HT.ORDER_STATUS.map(s=><option key={s.id} value={s.id}>{t(s.key)}</option>)}</select>;
    if (param === 'conv_status') return <select className="field" style={{ width:'100%' }} value={value} onChange={e=>onChange(e.target.value)}>{['open','pending','resolved'].map(s=><option key={s} value={s}>{t(window.HT.CONV_STATUS[s].key)}</option>)}</select>;
    if (param === 'template') return <select className="field" style={{ width:'100%' }} value={value} onChange={e=>onChange(e.target.value)}>{window.HT.CANNED.map(k=><option key={k.id} value={k.id}>{window.L(k.title, lang)} ({k.shortcut})</option>)}</select>;
    if (param === 'area') return <select className="field" style={{ width:'100%' }} value={value} onChange={e=>onChange(e.target.value)}>{window.HT.AREAS.map(a=><option key={a.id} value={a.id}>{window.L(a.name, lang)}</option>)}</select>;
    if (param === 'agent') return <select className="field" style={{ width:'100%' }} value={value} onChange={e=>onChange(e.target.value)}>{window.HT.AGENTS.filter(a=>a.role!=='viewer').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>;
    if (param === 'tag') return <select className="field" style={{ width:'100%' }} value={value} onChange={e=>onChange(e.target.value)}>{['VIP','Mayoreo','Urgente','Recurrente','Negocio'].map(tg=><option key={tg} value={tg}>{tg}</option>)}</select>;
    return null;
  };

  // preview
  const tplPreview = (act.param === 'template') ? window.L(window.HT.cannedById(actVal).body, lang) : null;

  return (
    <Modal title={id ? t('edit_flow') : t('new_flow')} icon="bolt" onClose={close} wide
      foot={<><button className="btn btn-ghost grow" onClick={close}>{t('cancel')}</button><button className="btn btn-primary grow" onClick={save}><Icon name="check" size={15}/>{t('save')}</button></>}>
      <div style={{ paddingBottom:16, display:'flex', flexDirection:'column', gap:14 }}>
        <div><label className="lbl">{t('flow_name')}</label><input className="field" style={{ width:'100%' }} value={name} onChange={e=>setName(e.target.value)} placeholder={lang==='es'?'Pedido listo → avisar al cliente':'Order ready → notify customer'} /></div>

        <div className="flow-builder">
          <div className="flow-step when-step">
            <div className="lab"><Icon name="bolt" size={14}/>{t('flow_when')}</div>
            <select className="field" style={{ width:'100%', marginBottom: trg.param ? 8 : 0 }} value={trgType} onChange={e=>onTrgType(e.target.value)}>
              {window.HT.TRIGGERS.map(x=><option key={x.id} value={x.id}>{window.tr(x.key, lang)}</option>)}
            </select>
            {trg.param && <ValueSelect param={trg.param} value={trgVal} onChange={setTrgVal} />}
          </div>
          <div className="flow-connector"><Icon name="chevd" size={18}/></div>
          <div className="flow-step then-step">
            <div className="lab"><Icon name="arrowr" size={14}/>{t('flow_then')}</div>
            <select className="field" style={{ width:'100%', marginBottom: act.param ? 8 : 0 }} value={actType} onChange={e=>onActType(e.target.value)}>
              {window.HT.ACTIONS.map(x=><option key={x.id} value={x.id}>{window.tr(x.key, lang)}</option>)}
            </select>
            {act.param && <ValueSelect param={act.param} value={actVal} onChange={setActVal} />}
          </div>
        </div>

        {tplPreview && (
          <div><label className="lbl">{t('flow_preview')}</label>
            <div className="msg out" style={{ maxWidth:'100%' }}><div className="bubble" style={{ borderBottomRightRadius:16 }}>{renderTemplate(tplPreview)}</div></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ModalRoot() {
  const { state } = useApp();
  const mo = state.modal; if (!mo) return null;
  if (mo.type === 'transfer') return <TransferModal target={mo.target} />;
  if (mo.type === 'newOrder') return <NewOrderModal contactId={mo.contactId} />;
  if (mo.type === 'qr') return <QRModal />;
  if (mo.type === 'cannedEdit') return <CannedEditModal id={mo.id} />;
  if (mo.type === 'invite') return <InviteModal />;
  if (mo.type === 'flowEdit') return <FlowEditModal id={mo.id} />;
  return null;
}

Object.assign(window, { ModalRoot, TransferModal, NewOrderModal, QRModal, CannedEditModal, InviteModal, FlowEditModal, FauxQR });
