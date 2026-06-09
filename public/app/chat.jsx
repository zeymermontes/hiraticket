/* ============================================================
   HIRATICKET — Chat (3-column workspace)
   ============================================================ */

function relName(name) { return (name || '').split(' ')[0]; }

/* ---------- Conversation list row ---------- */
function ConvRow({ conv, selected, onClick }) {
  const lang = useLang();
  const contact = window.HT.contactById(conv.contactId);
  const assignee = window.HT.agentById(conv.assignee);
  return (
    <div className={'conv' + (selected ? ' sel' : '') + (conv.unread ? ' unread' : '')} onClick={onClick}>
      <Avatar contact={contact} size={42} />
      <div className="conv-body">
        <div className="conv-top">
          <span className="conv-name truncate">{contact.name}</span>
          <span className="conv-time">{conv.time}</span>
        </div>
        <div className="conv-prev truncate">{window.L(conv.preview, lang)}</div>
        <div className="conv-meta">
          <ConvStatusPill status={conv.status} />
          <AreaTag area={conv.area} />
          <span className="grow" />
          {assignee ? <Avatar agent={assignee} size={20} /> : <Pill color="slate">{window.tr('tab_unassigned', lang)}</Pill>}
          {conv.unread > 0 && <span className="badge badge-red">{conv.unread}</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Conversation list column ---------- */
function ConvList() {
  const { state, dispatch } = useApp();
  const t = useT(); const lang = state.lang;
  const f = state.convFilters;
  const me = state.currentUser;

  let list = state.conversations.filter(c => {
    if (state.chatTab === 'mine' && c.assignee !== me) return false;
    if (state.chatTab === 'unassigned' && c.assignee != null) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.area && c.area !== f.area) return false;
    if (f.unreadOnly && !c.unread) return false;
    if (f.q) {
      const ct = window.HT.contactById(c.contactId);
      if (!(ct.name.toLowerCase().includes(f.q.toLowerCase()) || window.L(c.preview, lang).toLowerCase().includes(f.q.toLowerCase()))) return false;
    }
    return true;
  }).sort((a, b) => a.sortTs - b.sortTs);

  const mineN = state.conversations.filter(c => c.assignee === me).length;
  const unN = state.conversations.filter(c => c.assignee == null).length;
  const setF = (patch) => dispatch({ type:'setConvFilter', patch });

  const FilterBtn = ({ icon, label, value, options }) => (
    <Popover trigger={(open, tog) => (
      <button className={'btn btn-sm btn-outline' + (value ? ' ' : '')} onClick={tog} style={value ? { borderColor:'var(--brand)', color:'var(--brand-700)', background:'var(--brand-50)' } : null}>
        <Icon name={icon} size={14}/> {value ? options.find(o => o.id === value).label : label} <Icon name="chevd" size={13}/>
      </button>
    )}>
      {(close) => (<div style={{ minWidth:160 }}>
        <button className="menu-item" onClick={() => { setF({ [label==='__']:null }); close(); }} style={{ display:'none' }} />
        {options.map(o => (
          <button className="menu-item" key={o.id} onClick={() => { setF(o.patch); close(); }}>{o.label}{value===o.id && <Icon name="check" size={15}/>}</button>
        ))}
      </div>)}
    </Popover>
  );

  return (
    <div className="chatcol list">
      <div className="col-head">
        <div className="seg" style={{ width:'100%' }}>
          {[['mine', t('tab_mine'), mineN], ['unassigned', t('tab_unassigned'), unN], ['all', t('tab_all'), null]].map(([id, lbl, n]) => (
            <button key={id} className={state.chatTab===id?'on':''} style={{ flex:1, justifyContent:'center' }} onClick={() => dispatch({ type:'setChatTab', tab:id })}>
              {lbl}{n != null && n > 0 && <span className="badge badge-soft">{n}</span>}
            </button>
          ))}
        </div>
        <div className="field field-sm field-filled">
          <Icon name="search"/>
          <input placeholder={t('search_ph')} value={f.q} onChange={e => setF({ q:e.target.value })}/>
        </div>
        <div className="row gap-2" style={{ flexWrap:'wrap' }}>
          <FilterBtn icon="status" label={t('filter_status')} value={f.status} options={[
            { id:null, label: state.lang==='es'?'Todos':'All', patch:{ status:null } },
            { id:'open', label: t('st_open'), patch:{ status:'open' } },
            { id:'pending', label: t('st_pending'), patch:{ status:'pending' } },
            { id:'resolved', label: t('st_resolved'), patch:{ status:'resolved' } },
          ]} />
          <FilterBtn icon="layers" label={t('filter_area')} value={f.area} options={[
            { id:null, label: state.lang==='es'?'Todas':'All', patch:{ area:null } },
            ...window.HT.AREAS.map(a => ({ id:a.id, label: window.L(a.name, lang), patch:{ area:a.id } })),
          ]} />
          <button className={'btn btn-sm ' + (f.unreadOnly ? 'btn-primary' : 'btn-outline')} onClick={() => setF({ unreadOnly: !f.unreadOnly })}>
            <Icon name="dot" size={12}/> {t('unread_only')}
          </button>
        </div>
      </div>
      <div className="col-scroll scroll">
        {list.length === 0 ? (
          <div className="empty" style={{ padding:'56px 24px' }}>
            <div className="empty-art"><Icon name="chat"/></div>
            <h3>{t('no_convos')}</h3>
            <p>{t('no_convos_sub')}</p>
          </div>
        ) : list.map(c => (
          <ConvRow key={c.id} conv={c} selected={c.id === state.selectedConvId} onClick={() => dispatch({ type:'selectConv', id:c.id })} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Message bubble ---------- */
function Tick({ state }) {
  if (state === 'sent') return <Icon name="check" size={14}/>;
  return <span className={'tick' + (state==='read'?' read':'')} style={{ display:'inline-flex' }}><Icon name="checks" size={15}/></span>;
}
function MessageBubble({ msg }) {
  const lang = useLang();
  const out = msg.dir === 'out';
  const author = out && msg.author ? window.HT.agentById(msg.author) : null;
  return (
    <div className={'msg ' + (out ? 'out' : 'in')}>
      <div className="bubble">
        {out && author && <div style={{ fontSize:11, fontWeight:700, color:'var(--brand-700)', marginBottom:2 }}>{relName(author.name)}</div>}
        {msg.type === 'text' && <div>{window.L(msg.body, lang)}</div>}
        {msg.type === 'image' && (<div className="media-img"><div className="ph"><Icon name="image" size={22}/></div></div>)}
        {msg.type === 'audio' && (
          <div className="audio">
            <span className="iconbtn sm" style={{ background:'rgba(0,0,0,.06)' }}><Icon name="play" size={15}/></span>
            <span className="audio-wave">{Array.from({length:22}).map((_,i)=><i key={i} style={{ height: (5+Math.abs(Math.sin(i*1.3))*16)+'px' }}/>)}</span>
            <span className="t-xs mono">{msg.duration}</span>
          </div>
        )}
        {msg.type === 'doc' && (
          <div className="doc"><span className="doc-ic"><Icon name="file" size={17}/></span><div><div style={{ fontWeight:600, fontSize:12.5 }}>{msg.docName}</div><div className="t-xs muted">PDF · 248 KB</div></div></div>
        )}
        {msg.mediaCaption && <div className="t-xs muted mono" style={{ marginTop:4 }}>{window.L(msg.mediaCaption, lang)}</div>}
        <div className="bubble-meta">{msg.time}{out && <Tick state={msg.state}/>}</div>
      </div>
    </div>
  );
}

/* ---------- Canned picker ---------- */
function CannedPicker({ onInsert }) {
  const { state } = useApp(); const lang = state.lang; const t = useT();
  const cats = {};
  window.HT.CANNED.forEach(k => { (cats[k.category] = cats[k.category] || []).push(k); });
  return (
    <Popover align="right" trigger={(open, tog) => (
      <button className="iconbtn tip" data-tip={t('canned')} onClick={tog}><Icon name="canned"/></button>
    )}>
      {(close) => (
        <div style={{ width:320 }}>
          <div className="menu-label">{t('canned')}</div>
          {Object.keys(cats).map(cat => (
            <div key={cat}>
              <div style={{ padding:'6px 10px 2px', fontSize:11, fontWeight:700, color:'var(--text-faint)' }}>{t(cat)}</div>
              {cats[cat].map(k => (
                <button className="menu-item" key={k.id} style={{ flexDirection:'column', alignItems:'flex-start', gap:3 }} onClick={() => { onInsert(window.L(k.body, lang)); close(); }}>
                  <span style={{ display:'flex', width:'100%', gap:6, alignItems:'center' }}><span style={{ fontWeight:700 }}>{window.L(k.title, lang)}</span><span className="mono t-xs muted" style={{ marginLeft:'auto' }}>{k.shortcut}</span></span>
                  <span className="t-xs muted" style={{ whiteSpace:'normal', textAlign:'left', lineHeight:1.35 }}>{window.L(k.body, lang).slice(0, 64)}…</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

/* ---------- Composer ---------- */
function Composer({ conv }) {
  const { dispatch } = useApp(); const t = useT();
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const contact = window.HT.contactById(conv.contactId);
  const fill = (tpl) => tpl.replace(/\{\{name\}\}/g, relName(contact.name)).replace(/\{\{order_number\}\}/g, 'HIR-1042').replace(/\{\{total\}\}/g, '$1,450 MXN');
  const send = () => { if (!text.trim()) return; dispatch({ type:'sendMessage', convId: conv.id, text: text.trim() }); setText(''); };
  return (
    <div className="composer">
      <div className="composer-box">
        <div className="composer-input">
          <textarea ref={taRef} className="bare" rows={1} placeholder={t('composer_ph')} value={text}
            onChange={e => { setText(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'; }}
            onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        </div>
        <div className="composer-actions">
          <button className="iconbtn"><Icon name="paperclip"/></button>
          <button className="iconbtn"><Icon name="smile"/></button>
          <CannedPicker onInsert={(tpl) => setText(text ? text + ' ' + fill(tpl) : fill(tpl))} />
          <span className="grow" />
          <button className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim()}><Icon name="send" size={15}/> {t('send')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Workspace (center column) ---------- */
function Workspace({ conv }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const contact = window.HT.contactById(conv.contactId);
  const orders = state.orders.filter(o => o.contactId === conv.contactId);
  const [note, setNote] = useState('');
  const [showActivity, setShowActivity] = useState(true);

  const target = { kind:'conversation', id: conv.id };
  const addNote = () => { if (!note.trim()) return; dispatch({ type:'addNote', target, body: note.trim() }); setNote(''); };

  return (
    <div className="chatcol ctx">
      <div className="ws scroll">
        {/* contact */}
        <div className="ws-contact">
          <div className="row gap-3">
            <Avatar contact={contact} size={52} />
            <div className="grow" style={{ minWidth:0 }}>
              <div style={{ fontWeight:800, fontSize:16 }} className="truncate">{contact.name}</div>
              <div className="row gap-2" style={{ marginTop:3 }}><Icon name="whatsapp" size={14} /><span className="mono t-sm muted nowrap">{contact.phone}</span></div>
            </div>
            <button className="iconbtn tip" data-tip={t('full_history')} onClick={()=>dispatch({ type:'setChatExpanded', value:true })}><Icon name="expand"/></button>
            <Popover align="right" trigger={(o,tog)=><button className="iconbtn" onClick={tog}><Icon name="dots"/></button>}>
              {(close)=>(<div><button className="menu-item" onClick={close}><Icon name="user" size={16}/>{lang==='es'?'Ver perfil':'View profile'}</button><button className="menu-item" onClick={close}><Icon name="pin" size={16}/>{lang==='es'?'Fijar chat':'Pin chat'}</button></div>)}
            </Popover>
          </div>
          <div className="row gap-2" style={{ flexWrap:'wrap' }}>
            {contact.tags.map(tg => <Pill key={tg} color="brand"><Icon name="tag" size={12}/>{tg}</Pill>)}
            <AreaTag area={conv.area} />
          </div>
          <div className="col gap-1" style={{ paddingTop:4 }}>
            <div className="kv"><span className="k">{t('lifetime')}</span><span className="v mono">{window.HT.money(contact.lifetime)}</span></div>
            <div className="kv"><span className="k">{t('first_seen')}</span><span className="v">{window.L(contact.firstSeen, lang)}</span></div>
          </div>
          <button className="btn btn-dark btn-block" style={{ marginTop:2 }} onClick={()=>dispatch({ type:'setChatExpanded', value:true })}><Icon name="expand" size={15}/>{t('full_history')}<span className="grow"/><Icon name="arrowr" size={15}/></button>
        </div>

        {/* orders */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="orders" size={16}/><h4 className="grow">{t('ws_orders')} <span className="muted">· {orders.length}</span></h4>
            <button className="btn btn-sm btn-outline" onClick={() => dispatch({ type:'openModal', modal:{ type:'newOrder', contactId: contact.id } })}><Icon name="plus" size={14}/>{t('add_order')}</button>
          </div>
          <div className="ws-block-body col gap-2">
            {orders.length === 0 ? <div className="muted t-sm" style={{ padding:'6px 2px' }}>{t('no_orders_yet')}</div> :
              orders.map(o => (
                <div key={o.id} className="ocard" onClick={() => dispatch({ type:'selectOrder', id:o.id, from:'chat' })}>
                  <div className="ocard-top"><span className="ocard-id mono">{o.code}</span><span className="grow" /><OrderStatusPill status={o.status} /></div>
                  <div className="t-sm muted truncate">{window.L(o.items[0].name, lang)}{o.items.length>1?` +${o.items.length-1}`:''}</div>
                  <div className="ocard-foot"><AreaTag area={o.area} /><span className="grow" /><span className="mono" style={{ fontWeight:700, color:'var(--text)' }}>{window.HT.money(o.total)}</span></div>
                </div>
              ))}
          </div>
        </div>

        {/* actions */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="sliders" size={16}/><h4>{t('ws_actions')}</h4></div>
          <div className="ws-block-body">
            <div className="actions-grid">
              <button className="act" onClick={() => dispatch({ type:'openModal', modal:{ type:'transfer', target } })}><Icon name="swap"/>{t('act_transfer')}</button>
              <Popover trigger={(o,tog)=><button className="act" onClick={tog}><Icon name="status"/>{t('act_status')}</button>}>
                {(close)=>(<div style={{ minWidth:170 }}>{['open','pending','resolved'].map(s=>(
                  <button className="menu-item" key={s} onClick={()=>{ dispatch({ type:'setConvStatus', convId:conv.id, status:s }); close(); }}><Pill color={window.HT.CONV_STATUS[s].color} dot>{t(window.HT.CONV_STATUS[s].key)}</Pill>{conv.status===s&&<Icon name="check" size={15}/>}</button>
                ))}</div>)}
              </Popover>
              <Popover trigger={(o,tog)=><button className="act" onClick={tog}><Icon name="tag"/>{t('act_tag')}</button>}>
                {(close)=>(<div style={{ minWidth:160 }}>{['Mayoreo','VIP','Urgente','Recurrente','Negocio'].map(tg=>(<button className="menu-item" key={tg} onClick={()=>{ dispatch({ type:'toast', toast:{ icon:'tag', title: state.lang==='es'?'Etiqueta agregada':'Tag added', sub: tg } }); close(); }}><Icon name="tag" size={15}/>{tg}</button>))}</div>)}
              </Popover>
              <button className="act" onClick={() => dispatch({ type:'openModal', modal:{ type:'newOrder', contactId: contact.id } })}><Icon name="plus"/>{t('act_order')}</button>
              <button className="act warn full" onClick={() => dispatch({ type:'toast', toast:{ icon:'clock', tone:'blue', title: state.lang==='es'?'Seguimiento programado':'Follow-up scheduled', sub: state.lang==='es'?'Mañana 10:00':'Tomorrow 10:00 AM' } })}><Icon name="clock"/>{t('act_followup')}</button>
              {conv.status === 'resolved'
                ? <button className="act full" onClick={() => dispatch({ type:'setConvStatus', convId:conv.id, status:'open' })}><Icon name="refresh"/>{t('act_reopen')}</button>
                : <button className="act good full" onClick={() => dispatch({ type:'resolveConv', convId:conv.id })}><Icon name="check"/>{t('act_resolve')}</button>}
            </div>
          </div>
        </div>

        {/* notes */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="edit" size={16}/><h4 className="grow">{t('ws_notes')}</h4><Pill color="amber"><Icon name="lock" size={11}/>{lang==='es'?'Interno':'Internal'}</Pill></div>
          <div className="ws-block-body">
            <div className="field field-filled" style={{ height:'auto', alignItems:'flex-start', padding:'8px 10px', marginBottom:8 }}>
              <textarea className="bare" rows={2} placeholder={t('add_note_ph')} value={note} onChange={e=>setNote(e.target.value)} style={{ fontSize:13 }}/>
            </div>
            {note.trim() && <button className="btn btn-sm btn-primary" style={{ marginBottom:10 }} onClick={addNote}><Icon name="send" size={14}/>{t('post_note')}</button>}
            {conv.notes.length === 0 ? <div className="muted t-sm">{lang==='es'?'Aún no hay notas internas.':'No internal notes yet.'}</div> :
              conv.notes.map((n, i) => {
                const au = window.HT.agentById(n.author);
                return (<div className="note" key={i}><Avatar agent={au} size={28}/><div className="note-body note-yellow"><div className="note-head"><span className="note-author">{au.name}</span><span className="note-time">{window.L(n.time, lang)}</span></div><div className="note-text">{window.L(n.body, lang)}</div></div></div>);
              })}
          </div>
        </div>

        {/* activity */}
        <div className="ws-block">
          <button className="ws-block-head" style={{ width:'100%', background:'none', border:'none', borderBottom:'1px solid var(--border)' }} onClick={()=>setShowActivity(s=>!s)}>
            <Icon name="clock" size={16}/><h4 className="grow" style={{ textAlign:'left' }}>{t('ws_activity')}</h4><Icon name={showActivity?'chevd':'chevr'} size={16}/>
          </button>
          {showActivity && <div className="ws-block-body"><div className="timeline">
            {conv.events.map((e, i) => (<div className="tl" key={i}><div className="tl-dot"><div className="tl-ic"><Icon name={e.ic} size={13}/></div></div><div className="tl-body">{window.L(e.text, lang)}<div className="tl-time">{e.time}</div></div></div>))}
          </div></div>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Thread (right column) ---------- */
function Thread({ conv }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const contact = window.HT.contactById(conv.contactId);
  const assignee = window.HT.agentById(conv.assignee);
  const endRef = useRef(null);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [conv.messages.length, conv.id]);

  if (state.connection === 'disconnected') return <NotConnected />;

  return (
    <div className="chatcol">
      <div className="thread-head">
        <Avatar contact={contact} size={38} />
        <div className="grow" style={{ minWidth:0 }}>
          <div className="row gap-2"><span style={{ fontWeight:700 }} className="truncate">{contact.name}</span><span className="pill pill-green" style={{ height:18, padding:'0 6px' }}><Icon name="whatsapp" size={11}/>WhatsApp</span></div>
          <div className="t-xs muted">{assignee ? (lang==='es'?'Atiende ':'Handled by ') + relName(assignee.name) : t('tab_unassigned')}</div>
        </div>
        <button className={'iconbtn tip' + (state.ctxVisible?' active':'')} data-tip={lang==='es'?(state.ctxVisible?'Ocultar panel del cliente':'Mostrar panel del cliente'):(state.ctxVisible?'Hide customer panel':'Show customer panel')} onClick={()=>dispatch({ type:'toggleCtx' })}><Icon name="columns"/></button>
        {!conv.assignee && <button className="btn btn-sm btn-primary" onClick={()=>dispatch({ type:'acceptConv', convId:conv.id })}><Icon name="check" size={14}/>{t('act_accept')}</button>}
        <button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'openModal', modal:{ type:'transfer', target:{ kind:'conversation', id:conv.id } } })}><Icon name="swap" size={14}/>{t('act_transfer')}</button>
        {conv.status !== 'resolved'
          ? <button className="iconbtn tip" data-tip={t('act_resolve')} onClick={()=>dispatch({ type:'resolveConv', convId:conv.id })} style={{ color:'var(--green)' }}><Icon name="check"/></button>
          : <Pill color="green" dot>{t('st_resolved')}</Pill>}
      </div>
      <div className="thread thread-wa-tint scroll" ref={endRef}>
        {conv.messages.map((m, i) => m.day
          ? <div className="day-sep" key={'d'+i}>{window.L(m.day, lang)}</div>
          : <MessageBubble key={m.id} msg={m} />)}
      </div>
      <Composer conv={conv} />
    </div>
  );
}

function NotConnected() {
  const { dispatch } = useApp(); const t = useT();
  return (
    <div className="chatcol center" style={{ background:'var(--bg)' }}>
      <div className="empty">
        <div className="empty-art" style={{ background:'var(--red-bg)', borderColor:'var(--red-bd)', color:'var(--red)' }}><Icon name="wifioff"/></div>
        <h3>{t('disconnected')}</h3>
        <p>{t('drop_banner')}</p>
        <button className="btn btn-primary" onClick={()=>dispatch({ type:'openModal', modal:{ type:'qr' } })}><Icon name="qr" size={16}/>{t('scan_qr')}</button>
      </div>
    </div>
  );
}

/* ---------- Empty (no conversation) ---------- */
function ChatEmpty() {
  const t = useT();
  return (
    <div className="chatcol center" style={{ gridColumn:'2 / -1', background:'var(--bg)' }}>
      <div className="empty">
        <div className="empty-art"><Icon name="chat"/></div>
        <h3>{t('empty_chat')}</h3>
        <p>{t('empty_chat_sub')}</p>
      </div>
    </div>
  );
}

/* ---------- Customer 360 — expandable takeover ---------- */
function CustomerOverlay({ conv }) {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const contact = window.HT.contactById(conv.contactId);
  const orders = state.orders.filter(o => o.contactId === conv.contactId);
  const openCount = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length;
  const [tab, setTab] = useState('orders');

  const history = [];
  conv.events.forEach(e => history.push({ ic:e.ic, text:e.text, time:e.time, src:'Chat' }));
  orders.forEach(o => o.events.forEach(e => history.push({ ic:e.ic, text:e.text, time:e.time, src:o.code })));

  const allNotes = [
    ...conv.notes.map(n => ({ ...n, src:'Chat' })),
    ...orders.flatMap(o => o.notes.map(n => ({ ...n, src:o.code }))),
  ];

  return (
    <div className="cust360">
      <div className="cust360-head">
        <button className="btn btn-outline btn-sm" onClick={()=>dispatch({ type:'setChatExpanded', value:false })}><span style={{ transform:'rotate(180deg)', display:'inline-flex' }}><Icon name="chevr" size={14}/></span>{t('back_to_chat')}</button>
        <Avatar contact={contact} size={44} />
        <div className="grow" style={{ minWidth:0 }}>
          <div className="row gap-2"><span style={{ fontWeight:800, fontSize:17 }} className="truncate">{contact.name}</span><span className="pill pill-green" style={{ height:20 }}><Icon name="whatsapp" size={12}/>WhatsApp</span></div>
          <div className="t-sm muted mono">{contact.phone}</div>
        </div>
        <div className="row gap-2">{contact.tags.map(tg=><Pill key={tg} color="brand"><Icon name="tag" size={11}/>{tg}</Pill>)}<AreaTag area={conv.area} /></div>
      </div>

      <div className="cust360-body scroll">
        <div className="c360-stats">
          <div className="c360-stat"><div className="lbl2"><Icon name="orders" size={14}/>{t('stat_spent')}</div><div className="val2 mono">{window.HT.money(contact.lifetime)}</div></div>
          <div className="c360-stat"><div className="lbl2"><Icon name="orders" size={14}/>{t('stat_orders')}</div><div className="val2">{orders.length}</div></div>
          <div className="c360-stat"><div className="lbl2"><Icon name="clock" size={14}/>{t('stat_open')}</div><div className="val2">{openCount}</div></div>
          <div className="c360-stat"><div className="lbl2"><Icon name="calendar" size={14}/>{t('first_seen')}</div><div className="val2" style={{ fontSize:18 }}>{window.L(contact.firstSeen, lang)}</div></div>
        </div>

        <div className="seg c360-tabs">
          {[['orders', t('stat_orders'), orders.length], ['history', t('tab_history'), history.length], ['notes', t('ws_notes'), allNotes.length]].map(([id,lbl,n])=>(
            <button key={id} className={tab===id?'on':''} onClick={()=>setTab(id)}>{lbl}{n>0&&<span className="badge badge-soft">{n}</span>}</button>
          ))}
        </div>

        {tab==='orders' && (
          orders.length===0 ? <div className="empty"><div className="empty-art"><Icon name="orders"/></div><p>{t('no_orders_yet')}</p></div> :
          <div className="c360-orders">
            {orders.map(o=>{ const ag=window.HT.agentById(o.assignee); const curIdx=state.config.stages.findIndex(s=>s.id===o.status); return (
              <div className="o360" key={o.id}>
                <div className="row gap-2"><span className="mono" style={{ fontWeight:800, fontSize:14 }}>{o.code}</span><span className="grow"/><OrderStatusPill status={o.status} /></div>
                <div className="pipe" style={{ marginTop:2 }}>
                  {state.config.stages.map((s,i)=>(<span key={s.id} className={'pipe-step '+(i<curIdx?'done':i===curIdx?'cur':'')} style={{ cursor:'default', fontSize:10 }}>{window.L(s.name, lang)}</span>))}
                </div>
                <div className="o360-items">
                  {o.items.map((li,i)=>(<div className="o360-item" key={i}><span className="nm truncate">{window.L(li.name, lang)}</span><span className="t-xs muted mono">×{li.qty}</span><span className="mono" style={{ fontWeight:700 }}>{window.HT.money(li.sub)}</span></div>))}
                </div>
                <div className="row gap-2"><AreaTag area={o.area}/><PriorityFlag priority={o.priority}/><span className="grow"/><span className="mono" style={{ fontWeight:800 }}>{window.HT.money(o.total)}</span></div>
                <div className="row gap-2"><span className="t-xs muted grow">{lang==='es'?'Creado':'Created'} {window.L(o.created,lang)} · {window.L(o.updated,lang)}</span>{ag&&<Avatar agent={ag} size={22}/>}<button className="btn btn-sm btn-outline" onClick={()=>dispatch({ type:'selectOrder', id:o.id, from:'chat' })}>{lang==='es'?'Abrir':'Open'}<Icon name="arrowr" size={13}/></button></div>
              </div>
            ); })}
          </div>
        )}

        {tab==='history' && (
          <div className="c360-cols">
            <div className="ws-block"><div className="ws-block-head"><Icon name="history" size={16}/><h4>{t('full_history')}</h4></div>
              <div className="ws-block-body"><div className="timeline">
                {history.length===0 ? <div className="muted t-sm">{t('no_history')}</div> :
                  history.map((e,i)=>(<div className="tl" key={i}><div className="tl-dot"><div className="tl-ic"><Icon name={e.ic} size={13}/></div></div><div className="tl-body"><div className="row gap-2"><span>{window.L(e.text, lang)}</span><span className="pill pill-slate" style={{ height:18 }}>{e.src}</span></div><div className="tl-time">{typeof e.time==='string'?e.time:window.L(e.time, lang)}</div></div></div>))}
              </div></div>
            </div>
            <div className="ws-block"><div className="ws-block-head"><Icon name="chat" size={16}/><h4>{lang==='es'?'Conversación':'Conversation'}</h4></div>
              <div className="ws-block-body"><div className="thread" style={{ padding:0, background:'transparent', gap:3 }}>
                {conv.messages.filter(m=>!m.day).slice(-6).map((m,i)=><MessageBubble key={i} msg={m} />)}
              </div></div>
            </div>
          </div>
        )}

        {tab==='notes' && (
          allNotes.length===0 ? <div className="empty"><div className="empty-art"><Icon name="edit"/></div><p>{lang==='es'?'Sin notas internas.':'No internal notes.'}</p></div> :
          <div style={{ maxWidth:680 }}>{allNotes.map((n,i)=>{ const au=window.HT.agentById(n.author); return (<div className="note" key={i}><Avatar agent={au} size={30}/><div className="note-body note-yellow"><div className="note-head"><span className="note-author">{au.name}</span><span className="pill pill-slate" style={{ height:17 }}>{n.src}</span><span className="note-time">{window.L(n.time, lang)}</span></div><div className="note-text">{window.L(n.body, lang)}</div></div></div>); })}</div>
        )}
      </div>
    </div>
  );
}

/* ---------- Chat view ---------- */
function ChatView() {
  const { state } = useApp();
  const conv = state.conversations.find(c => c.id === state.selectedConvId);
  const showCtx = state.ctxVisible;
  return (
    <div className={'chat' + (state.density==='compact'?' dense':'') + (showCtx?'':' no-ctx')} style={{ position:'relative' }}>
      <ConvList />
      {conv ? (<>{showCtx && <Workspace conv={conv} />}<Thread conv={conv} /></>) : <ChatEmpty />}
      {conv && state.chatExpanded && <CustomerOverlay conv={conv} />}
    </div>
  );
}

Object.assign(window, { ChatView });
