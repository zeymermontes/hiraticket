/* ============================================================
   HIRATICKET — Kanban board (group by status / area, drag)
   ============================================================ */

function KCard({ order, onDragStart, onDragEnd, dragging }) {
  const { state, dispatch } = useApp(); const lang = state.lang; const t = useT();
  const c = window.HT.contactById(order.contactId);
  const ag = window.HT.agentById(order.assignee);
  return (
    <div className={'kcard' + (dragging ? ' dragging' : '')} draggable onDragStart={e=>onDragStart(e, order.id)} onDragEnd={onDragEnd}
      onClick={()=>dispatch({ type:'selectOrder', id:order.id, from:'kanban' })}>
      <div className="row gap-2">
        <span className="mono t-xs" style={{ fontWeight:700, color:'var(--text-muted)' }}>{order.code}</span>
        <span className="grow" />
        <PriorityFlag priority={order.priority} />
        <Popover align="right" trigger={(o,tog)=><button className="iconbtn sm" onClick={e=>{ e.stopPropagation(); tog(); }}><Icon name="dots" size={15}/></button>}>
          {(close)=>(<div onClick={e=>e.stopPropagation()}>
            <button className="menu-item" onClick={()=>{ dispatch({ type:'selectOrder', id:order.id, from:'kanban' }); close(); }}><Icon name="eye" size={16}/>{t('card_open')}</button>
            <button className="menu-item" onClick={()=>{ dispatch({ type:'openModal', modal:{ type:'transfer', target:{ kind:'order', id:order.id } } }); close(); }}><Icon name="swap" size={16}/>{t('card_transfer')}</button>
            <button className="menu-item" onClick={()=>{ dispatch({ type:'selectOrder', id:order.id, from:'kanban' }); close(); }}><Icon name="edit" size={16}/>{t('card_note')}</button>
          </div>)}
        </Popover>
      </div>
      <div className="kcard-title">{window.L(order.items[0].name, lang)}</div>
      <div className="row gap-2"><Avatar contact={c} size={20}/><span className="t-xs muted truncate">{c.name}</span></div>
      <div className="kcard-foot">
        <AreaTag area={order.area} />
        <span className="grow" />
        <span className="kcard-meta"><span className="mono" style={{ fontWeight:700, color:'var(--text)' }}>{window.HT.money(order.total).replace(' MXN','')}</span></span>
        {ag && <Avatar agent={ag} size={22}/>}
      </div>
    </div>
  );
}

function KanbanView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const group = state.kanbanGroup;
  const f = state.kanbanFilters;
  const setF = (patch) => dispatch({ type:'setKanbanFilter', patch });
  const [drag, setDrag] = useState(null);      // order id being dragged
  const [over, setOver] = useState(null);      // column id hovered

  const columns = group === 'status'
    ? state.config.stages.map(s => ({ id:s.id, label:window.L(s.name, lang), color:s.color, wip: s.id==='production'?6:null }))
    : state.config.areas.map(a => ({ id:a.id, label:window.L(a.name, lang), color:a.color, wip:null }));

  let pool = state.orders.filter(o => o.status !== 'cancelled').filter(o => {
    if (f.area && o.area !== f.area) return false;
    if (f.agent && o.assignee !== f.agent) return false;
    if (f.q) { const c = window.HT.contactById(o.contactId); if (!(o.code.toLowerCase().includes(f.q.toLowerCase()) || c.name.toLowerCase().includes(f.q.toLowerCase()))) return false; }
    return true;
  });
  const colOrders = (colId) => pool.filter(o => (group === 'status' ? o.status : o.area) === colId);

  const onDragStart = (e, id) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (colId) => {
    if (!drag) return;
    dispatch(group === 'status' ? { type:'moveOrderStatus', id:drag, status:colId, silent:false } : { type:'moveOrderArea', id:drag, area:colId });
    setDrag(null); setOver(null);
  };

  return (
    <div className="page">
      <div className="phead">
        <h1>{t('nav_kanban')}</h1>
        <span className="grow" />
        <span className="t-sm muted" style={{ fontWeight:600 }}>{t('group_by')}</span>
        <div className="seg">
          <button className={group==='status'?'on':''} onClick={()=>dispatch({ type:'setKanbanGroup', group:'status' })}><Icon name="status" size={14}/>{t('by_status')}</button>
          <button className={group==='area'?'on':''} onClick={()=>dispatch({ type:'setKanbanGroup', group:'area' })}><Icon name="layers" size={14}/>{t('by_area')}</button>
        </div>
      </div>

      <div className="toolbar" style={{ paddingBottom:12 }}>
        <div className="field field-sm" style={{ width:220 }}><Icon name="search"/><input placeholder={t('search_ph')} value={f.q} onChange={e=>setF({ q:e.target.value })}/></div>
        <FilterPill icon="layers" label={t('col_area')} value={f.area} onPick={(v)=>setF({ area:f.area===v?null:v })} options={[{ id:null, label:lang==='es'?'Todas':'All' }, ...window.HT.AREAS.map(a=>({ id:a.id, label:window.L(a.name,lang) }))]} />
        <FilterPill icon="user" label={t('col_assignee')} value={f.agent} onPick={(v)=>setF({ agent:f.agent===v?null:v })} options={[{ id:null, label:lang==='es'?'Todos':'All' }, ...window.HT.AGENTS.filter(a=>a.role!=='viewer').map(a=>({ id:a.id, label:a.name }))]} />
      </div>

      <div className="board scroll">
        <div className="board-inner">
          {columns.map(col => {
            const list = colOrders(col.id);
            const overWip = col.wip && list.length > col.wip;
            return (
              <div key={col.id} className={'kcol' + (over===col.id ? ' drop' : '')}
                onDragOver={e=>{ e.preventDefault(); setOver(col.id); }} onDragLeave={()=>setOver(o=>o===col.id?null:o)} onDrop={()=>onDrop(col.id)}>
                <div className="kcol-head">
                  <span className="ttl"><span className="dot" style={{ width:9, height:9, borderRadius:9, background:'var(--'+col.color+')', display:'inline-block', flex:'none' }}/><span className="truncate">{col.label}</span></span>
                  <span className="badge badge-soft">{list.length}</span>
                  <span className="grow" />
                  {col.wip && <span className="wip" style={overWip?{ color:'var(--red)', background:'var(--red-bg)', borderColor:'var(--red-bd)' }:null}>WIP {list.length}/{col.wip}</span>}
                </div>
                <div className="kcol-list scroll">
                  {list.map(o => <KCard key={o.id} order={o} onDragStart={onDragStart} onDragEnd={()=>{ setDrag(null); setOver(null); }} dragging={drag===o.id} />)}
                  {list.length === 0 && <div className="center" style={{ padding:'20px 0', color:'var(--text-faint)', fontSize:12 }}>{lang==='es'?'Vacío':'Empty'}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { KanbanView, KCard });
