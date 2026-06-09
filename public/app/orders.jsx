/* ============================================================
   HIRATICKET — Orders table + detail drawer
   (FilterPill is defined in components.jsx)
   ============================================================ */

/* ---------- Mobile chat panel (docked beside the order drawer) ---------- */
function MobileChatPanel({ conv, onClose }) {
  const { dispatch } = useApp(); const t = useT(); const lang = useLang();
  const contact = window.HT.contactById(conv.contactId);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [conv.messages.length, conv.id]);
  const send = () => { if (!text.trim()) return; dispatch({ type:'sendMessage', convId:conv.id, text:text.trim() }); setText(''); };
  return (
    <div className="mchat" onClick={(e)=>{ if (e.target.classList.contains('mchat')) onClose(); }}>
      <div className="mchat-phone">
        <div className="mchat-notch" />
        <div className="mchat-head">
          <Avatar contact={contact} size={32} />
          <div className="grow" style={{ minWidth:0 }}><div className="nm truncate">{contact.name}</div><div className="st row gap-1"><Icon name="whatsapp" size={11}/>{lang==='es'?'en línea':'online'}</div></div>
          <button className="iconbtn" style={{ color:'#fff' }} onClick={onClose}><Icon name="x"/></button>
        </div>
        <div className="mchat-thread scroll" ref={endRef}>
          {conv.messages.map((m, i) => m.day ? <div className="day-sep" key={'d'+i}>{window.L(m.day, lang)}</div> : <MessageBubble key={m.id} msg={m} />)}
        </div>
        <div className="mchat-composer">
          <div className="field field-filled"><input placeholder={t('composer_ph')} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') { e.preventDefault(); send(); } }} /></div>
          <button className="iconbtn active" onClick={send} aria-label="send"><Icon name="send"/></button>
        </div>
      </div>
    </div>
  );
}

function OrdersView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const f = state.orderFilters;
  const setF = (patch) => dispatch({ type:'setOrderFilter', patch });
  const sort = state.orderSort;

  let rows = state.orders.filter(o => {
    if (f.status && o.status !== f.status) return false;
    if (f.area && o.area !== f.area) return false;
    if (f.assignee && o.assignee !== f.assignee) return false;
    if (f.priority && o.priority !== f.priority) return false;
    if (f.q) { const c = window.HT.contactById(o.contactId); if (!(o.code.toLowerCase().includes(f.q.toLowerCase()) || c.name.toLowerCase().includes(f.q.toLowerCase()))) return false; }
    return true;
  });
  rows = rows.slice().sort((a, b) => {
    let av, bv;
    if (sort.key === 'total') { av = a.total; bv = b.total; }
    else if (sort.key === 'created') { av = a.sortCreated; bv = b.sortCreated; }
    else { av = a.code; bv = b.code; }
    const r = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === 'asc' ? r : -r;
  });

  const sel = state.selectedOrderIds;
  const allSel = rows.length > 0 && rows.every(o => sel.includes(o.id));
  const toggleAll = () => dispatch({ type:'selectAllOrders', ids: allSel ? [] : rows.map(o => o.id) });
  const Sort = ({ k, children }) => (
    <th className="sortable" onClick={() => dispatch({ type:'setOrderSort', key:k })}>
      <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>{children}{sort.key===k && <Icon name="chevd" size={12}/>}</span>
    </th>
  );

  return (
    <div className="page">
      <div className="phead">
        <h1>{window.HT.objectName ? window.HT.objectName(lang, state.config) : t('orders_title')}</h1>
        <Pill color="slate" large>{rows.length} {t('of_orders')}</Pill>
        <span className="grow" />
        <div className="seg">
          <button className={state.density==='comfortable'?'on':''} onClick={()=>dispatch({ type:'setDensity', density:'comfortable' })}><Icon name="sliders" size={14}/>{t('comfortable')}</button>
          <button className={state.density==='compact'?'on':''} onClick={()=>dispatch({ type:'setDensity', density:'compact' })}><Icon name="grip" size={14}/>{t('compact')}</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width:240 }}><Icon name="search"/><input placeholder={t('search_ph')} value={f.q} onChange={e=>setF({ q:e.target.value })}/></div>
        <FilterPill icon="status" label={t('col_status')} value={f.status} onPick={(v)=>setF({ status:f.status===v?null:v })} options={[{ id:null, label:lang==='es'?'Todos':'All' }, ...state.config.stages.map(s=>({ id:s.id, label:window.L(s.name,lang), swatch:<span className="dot" style={{ width:8, height:8, borderRadius:9, background:'var(--'+s.color+')', marginRight:2 }}/> }))]} />
        <FilterPill icon="layers" label={t('col_area')} value={f.area} onPick={(v)=>setF({ area:f.area===v?null:v })} options={[{ id:null, label:lang==='es'?'Todas':'All' }, ...state.config.areas.map(a=>({ id:a.id, label:window.L(a.name,lang) }))]} />
        <FilterPill icon="user" label={t('col_assignee')} value={f.assignee} onPick={(v)=>setF({ assignee:f.assignee===v?null:v })} options={[{ id:null, label:lang==='es'?'Todos':'All' }, ...window.HT.AGENTS.filter(a=>a.role!=='viewer').map(a=>({ id:a.id, label:a.name }))]} />
        <FilterPill icon="flag" label={t('col_priority')} value={f.priority} onPick={(v)=>setF({ priority:f.priority===v?null:v })} options={[{ id:null, label:lang==='es'?'Todas':'All' }, ...Object.keys(window.HT.PRIORITY).map(p=>({ id:p, label:t(window.HT.PRIORITY[p].key) }))]} />
        <span className="grow" />
        <button className="btn btn-sm btn-ghost"><Icon name="columns" size={14}/>{t('columns')}</button>
        <button className="btn btn-sm btn-ghost"><Icon name="download" size={14}/>{t('export')}</button>
      </div>

      {sel.length > 0 && (
        <div className="bulkbar">
          <span style={{ fontWeight:700 }}>{sel.length} {t('selected')}</span>
          <span style={{ opacity:.4 }}>·</span>
          <button className="btn btn-sm btn-dark" onClick={()=>dispatch({ type:'openModal', modal:{ type:'transfer', target:{ kind:'orders', ids:sel } } })}><Icon name="swap" size={14}/>{t('bulk_transfer')}</button>
          <button className="btn btn-sm btn-dark"><Icon name="status" size={14}/>{t('bulk_status')}</button>
          <button className="btn btn-sm btn-dark"><Icon name="tag" size={14}/>{t('bulk_tag')}</button>
          <span className="grow" />
          <button className="btn btn-sm btn-ghost" style={{ color:'#fff' }} onClick={()=>dispatch({ type:'selectAllOrders', ids:[] })}><Icon name="x" size={14}/>{t('clear')}</button>
        </div>
      )}

      <div className={'tablewrap scroll' + (state.density==='compact'?' dense':'')}>
        <table className="tbl">
          <thead><tr>
            <th style={{ width:42 }}><span className={'chk'+(allSel?' on':'')} onClick={toggleAll}><Icon name="check"/></span></th>
            <Sort k="code">{t('col_order')}</Sort>
            <th>{t('col_customer')}</th>
            <th>{t('col_status')}</th>
            <th>{t('col_area')}</th>
            <th>{t('col_assignee')}</th>
            <th>{t('col_priority')}</th>
            <th>{t('col_items')}</th>
            <Sort k="total">{t('col_total')}</Sort>
            <Sort k="created">{t('col_created')}</Sort>
            <th>{t('col_updated')}</th>
          </tr></thead>
          <tbody>
            {rows.map(o => {
              const c = window.HT.contactById(o.contactId); const ag = window.HT.agentById(o.assignee); const isSel = sel.includes(o.id);
              return (
                <tr key={o.id} className={isSel?'sel':''} onClick={()=>dispatch({ type:'selectOrder', id:o.id, from:'orders' })}>
                  <td onClick={e=>{ e.stopPropagation(); dispatch({ type:'toggleOrderSel', id:o.id }); }}><span className={'chk'+(isSel?' on':'')}><Icon name="check"/></span></td>
                  <td><span className="mono" style={{ fontWeight:700 }}>{o.code}</span></td>
                  <td><div className="cust"><Avatar contact={c} size={26}/><span className="truncate" style={{ maxWidth:150 }}>{c.name}</span></div></td>
                  <td><OrderStatusPill status={o.status} /></td>
                  <td><AreaTag area={o.area} /></td>
                  <td>{ag ? <div className="cust"><Avatar agent={ag} size={24}/><span className="t-sm truncate" style={{ maxWidth:96 }}>{relName(ag.name)}</span></div> : <span className="muted t-sm">—</span>}</td>
                  <td><PriorityFlag priority={o.priority} withLabel /></td>
                  <td><span className="t-sm truncate" style={{ display:'inline-block', maxWidth:180 }}>{window.L(o.items[0].name, lang)}{o.items.length>1?<span className="muted"> +{o.items.length-1}</span>:''}</span></td>
                  <td><span className="mono" style={{ fontWeight:700 }}>{window.HT.money(o.total)}</span></td>
                  <td className="muted t-sm">{window.L(o.created, lang)}</td>
                  <td className="muted t-sm">{window.L(o.updated, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row gap-3" style={{ padding:'0 24px 16px', color:'var(--text-muted)', fontSize:12.5 }}>
        <span>{lang==='es'?`Mostrando ${rows.length} de ${state.orders.length}`:`Showing ${rows.length} of ${state.orders.length}`} {t('of_orders')}</span>
        <span className="grow" />
        <button className="btn btn-sm btn-outline" disabled><Icon name="chevr" size={13} /></button>
        <span className="mono">1 / 1</span>
        <button className="btn btn-sm btn-outline" disabled><Icon name="chevr" size={13}/></button>
      </div>
    </div>
  );
}

/* ---------- Order detail drawer ---------- */
function OrderDrawer() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const o = state.orders.find(x => x.id === state.selectedOrderId);
  const [note, setNote] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  if (!o) return null;
  const c = window.HT.contactById(o.contactId);
  const ag = window.HT.agentById(o.assignee);
  const conv = o.convId ? state.conversations.find(v => v.id === o.convId) : null;
  const close = () => dispatch({ type:'closeOrder' });
  const target = { kind:'order', id:o.id };
  const addNote = () => { if (!note.trim()) return; dispatch({ type:'addNote', target, body: note.trim() }); setNote(''); };

  return (
    <>
    <Drawer onClose={close}>
      <div className="drawer-head">
        <span className="t-ic" style={{ width:40, height:40, borderRadius:11, background:'var(--brand-50)', color:'var(--brand-700)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="orders"/></span>
        <div className="grow" style={{ minWidth:0 }}>
          <div className="row gap-2"><span className="mono" style={{ fontWeight:800, fontSize:16 }}>{o.code}</span><OrderStatusPill status={o.status} /></div>
          <div className="t-sm muted">{lang==='es'?'Creado':'Created'} {window.L(o.created, lang)} · {lang==='es'?'Actualizado':'Updated'} {window.L(o.updated, lang)}</div>
        </div>
        <button className="iconbtn" onClick={close}><Icon name="x"/></button>
      </div>

      <div className="drawer-body scroll">
        {/* pipeline */}
        <div>
          <label className="lbl">{lang==='es'?'Etapa del pedido':'Order stage'}</label>
          <div className="pipe">
            {state.config.stages.map((s, i) => {
              const curIdx = state.config.stages.findIndex(x => x.id === o.status);
              const cls = i < curIdx ? 'done' : i === curIdx ? 'cur' : '';
              return <button className={'pipe-step ' + cls} key={s.id} onClick={()=>dispatch({ type:'moveOrderStatus', id:o.id, status:s.id })}>{window.L(s.name, lang)}</button>;
            })}
          </div>
        </div>

        {/* customer + linked chat */}
        <div className="card card-pad">
          <div className="row gap-3">
            <Avatar contact={c} size={42}/>
            <div className="grow" style={{ minWidth:0 }}>
              <div style={{ fontWeight:700 }} className="truncate">{c.name}</div>
              <div className="row gap-2"><Icon name="whatsapp" size={13}/><span className="mono t-sm muted">{c.phone}</span></div>
            </div>
            <AreaTag area={o.area} />
          </div>
          {conv && <button className={'btn btn-sm btn-block ' + (chatOpen?'btn-primary':'btn-outline')} style={{ marginTop:12 }} onClick={()=>setChatOpen(v=>!v)}><Icon name="whatsapp" size={14}/>{t('open_conversation')}<span className="grow"/><Icon name={chatOpen?'x':'arrowr'} size={14}/></button>}
        </div>

        {/* meta row */}
        <div className="row gap-3" style={{ flexWrap:'wrap' }}>
          <div className="col gap-1"><label className="lbl" style={{ margin:0 }}>{t('col_assignee')}</label>{ag ? <div className="cust"><Avatar agent={ag} size={24}/><span className="t-sm">{ag.name}</span></div> : <span className="muted t-sm">—</span>}</div>
          <div className="col gap-1"><label className="lbl" style={{ margin:0 }}>{t('col_priority')}</label><PriorityFlag priority={o.priority} withLabel /></div>
          <div className="col gap-1"><label className="lbl" style={{ margin:0 }}>{t('col_tags')}</label><div className="row gap-1">{o.tags.length?o.tags.map(tg=><Pill key={tg} color="slate"><Icon name="tag" size={11}/>{tg}</Pill>):<span className="muted t-sm">—</span>}</div></div>
        </div>

        {/* line items */}
        <div className="card">
          <div className="ws-block-head"><Icon name="orders" size={16}/><h4>{t('line_items')}</h4></div>
          <div style={{ padding:'4px 14px 12px' }}>
            {o.items.map((li, i) => (
              <div className="lineitem" key={i}>
                <div className="lineitem-thumb" />
                <div className="grow" style={{ minWidth:0 }}><div style={{ fontWeight:600, fontSize:13 }}>{window.L(li.name, lang)}</div><div className="t-xs muted mono">{li.qty} × {window.HT.money(li.unit).replace(' MXN','')}</div></div>
                <span className="mono" style={{ fontWeight:700 }}>{window.HT.money(li.sub)}</span>
              </div>
            ))}
            <div className="row" style={{ paddingTop:12, marginTop:4, borderTop:'1px solid var(--border)' }}>
              <span className="grow" style={{ fontWeight:700 }}>{t('col_total')}</span>
              <span className="mono" style={{ fontWeight:800, fontSize:16 }}>{window.HT.money(o.total)}</span>
            </div>
          </div>
        </div>

        {/* payment */}
        <div className="card">
          <div className="ws-block-head"><Icon name="orders" size={16}/><h4 className="grow">{t('pay_status')}</h4><Pill color={o.pay==='paid'?'green':o.pay==='partial'?'amber':'slate'} dot>{t(o.pay==='paid'?'pay_paid':o.pay==='partial'?'pay_partial':'pay_pending')}</Pill></div>
          <div style={{ padding:'12px 14px', display:'flex', gap:8 }}>
            <button className="btn btn-sm btn-outline grow" onClick={()=>dispatch({ type:'chargeOrder', id:o.id })}><Icon name="send" size={14}/>{t('send_pay_link')}</button>
            {o.pay!=='paid' && <button className="btn btn-sm btn-primary grow" onClick={()=>dispatch({ type:'markPaid', id:o.id })}><Icon name="check" size={14}/>{t('mark_paid')}</button>}
          </div>
        </div>

        {/* notes */}
        <div className="card">
          <div className="ws-block-head"><Icon name="edit" size={16}/><h4 className="grow">{t('ws_notes')}</h4><Pill color="amber"><Icon name="lock" size={11}/>{lang==='es'?'Interno':'Internal'}</Pill></div>
          <div style={{ padding:'12px 14px' }}>
            <div className="field field-filled" style={{ height:'auto', alignItems:'flex-start', padding:'8px 10px' }}><textarea className="bare" rows={2} placeholder={t('add_note_ph')} value={note} onChange={e=>setNote(e.target.value)} style={{ fontSize:13 }}/></div>
            {note.trim() && <button className="btn btn-sm btn-primary" style={{ marginTop:8 }} onClick={addNote}><Icon name="send" size={14}/>{t('post_note')}</button>}
            {o.notes.length>0 && <div style={{ marginTop:10 }}>{o.notes.map((n,i)=>{ const au=window.HT.agentById(n.author); return (<div className="note" key={i}><Avatar agent={au} size={26}/><div className="note-body"><div className="note-head"><span className="note-author">{au.name}</span><span className="note-time">{window.L(n.time,lang)}</span></div><div className="note-text">{window.L(n.body,lang)}</div></div></div>); })}</div>}
          </div>
        </div>

        {/* activity log */}
        <div className="card">
          <div className="ws-block-head"><Icon name="clock" size={16}/><h4>{t('activity_log')}</h4></div>
          <div style={{ padding:'10px 14px' }}><div className="timeline">
            {o.events.map((e, i) => { const ac = window.HT.agentById(e.actor); return (<div className="tl" key={i}><div className="tl-dot"><div className="tl-ic"><Icon name={e.ic} size={13}/></div></div><div className="tl-body">{window.L(e.text, lang)}{ac && <span className="muted"> · {relName(ac.name)}</span>}<div className="tl-time">{window.L(e.time, lang)}</div></div></div>); })}
          </div></div>
        </div>
      </div>

      <div className="drawer-foot">
        <button className="btn btn-outline grow" onClick={()=>dispatch({ type:'openModal', modal:{ type:'transfer', target } })}><Icon name="swap" size={15}/>{t('act_transfer')}</button>
        {o.status !== 'delivered'
          ? <button className="btn btn-primary grow" onClick={()=>{ const cur = state.config.stages.findIndex(x=>x.id===o.status); const next = state.config.stages[Math.min(cur+1, state.config.stages.length-1)]; dispatch({ type:'moveOrderStatus', id:o.id, status:next.id }); }}><Icon name="arrowr" size={15}/>{lang==='es'?'Avanzar etapa':'Advance stage'}</button>
          : <button className="btn btn-dark grow" onClick={close}><Icon name="check" size={15}/>{t('close')}</button>}
      </div>
    </Drawer>
    {conv && chatOpen && <MobileChatPanel conv={conv} onClose={()=>setChatOpen(false)} />}
    </>
  );
}

Object.assign(window, { OrdersView, OrderDrawer });
