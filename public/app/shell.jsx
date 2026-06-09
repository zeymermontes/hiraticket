/* ============================================================
   HIRATICKET — App shell (rail + top bar)
   ============================================================ */

function NavRail() {
  const { state, dispatch } = useApp();
  const t = useT();
  const unread = state.conversations.reduce((n, c) => n + (c.unread || 0), 0);
  const openOrders = state.orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length;
  const me = window.HT.agentById(state.currentUser);
  const objName = window.HT.objectName ? window.HT.objectName(state.lang, state.config) : t('nav_orders');

  const items = [
    { id: 'chat',     icon: 'chat',     label: t('nav_chat'),     badge: unread || null, red: true },
    { id: 'orders',   icon: 'orders',   label: objName,           badge: openOrders || null },
    { id: 'kanban',   icon: 'kanban',   label: t('nav_kanban') },
    { id: 'agenda',   icon: 'calendar', label: t('nav_agenda') },
  ];
  const admin = [
    { id: 'catalog',  icon: 'store',    label: t('nav_catalog') },
    { id: 'campaigns',icon: 'send',     label: t('nav_campaigns') },
    { id: 'reports',  icon: 'layers',   label: t('nav_reports') },
    { id: 'flows',    icon: 'bolt',     label: t('nav_flows') },
    { id: 'agents',   icon: 'agents',   label: t('nav_agents') },
    { id: 'canned',   icon: 'canned',   label: t('nav_canned') },
    { id: 'business', icon: 'sliders',  label: t('nav_business') },
    { id: 'settings', icon: 'settings', label: t('nav_settings') },
  ];

  const Item = (it) => (
    <button key={it.id} className={'rail-item' + (state.route === it.id ? ' on' : '')} onClick={() => dispatch({ type:'navigate', route: it.id })}>
      <Icon name={it.icon}/>
      <span className="rl">{it.label}</span>
      {it.badge != null && <span className={'badge' + (it.red ? ' badge-red' : '')}>{it.badge}</span>}
    </button>
  );

  return (
    <nav className="rail">
      <div className="rail-logo" title="Hiraticket">H</div>
      <div className="rail-nav">{items.map(Item)}</div>
      <div className="rail-sep" />
      <div className="rail-nav">{admin.map(Item)}</div>
      <div className="rail-foot">
        <Popover align="left" trigger={(open, tog) => (
          <button className="iconbtn" style={{ width:'auto', padding:2 }} onClick={tog}>
            <Avatar agent={me} size={38} />
          </button>
        )}>
          {(close) => (
            <div style={{ minWidth:210 }}>
              <div style={{ padding:'4px 8px 8px', display:'flex', gap:10, alignItems:'center' }}>
                <Avatar agent={me} size={38}/>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:13 }} className="truncate">{me.name}</div>
                  <div className="t-xs muted truncate">{me.email}</div>
                </div>
              </div>
              <div className="menu-sep" />
              <div style={{ padding:'4px 10px', display:'flex', alignItems:'center', gap:8 }}>
                <span className={'av-presence online'} style={{ position:'static', border:'none', width:8, height:8 }} />
                <span className="t-sm muted">{useT()('online')}</span>
                <span className="grow" />
                <Pill color="brand">{useT()('role_admin')}</Pill>
              </div>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { dispatch({ type:'navigate', route:'settings' }); close(); }}><Icon name="settings" size={16}/>{useT()('nav_settings')}</button>
              <a className="menu-item" href="Landing.html"><Icon name="store" size={16}/>{state.lang==='es'?'Sitio público':'Public site'}</a>
              <a className="menu-item danger" href="Login.html"><Icon name="lock" size={16}/>{state.lang==='es'?'Cerrar sesión':'Sign out'}</a>
            </div>
          )}
        </Popover>
      </div>
    </nav>
  );
}

function ConnectionChip() {
  const { state, dispatch } = useApp();
  const t = useT();
  const c = state.connection;
  const cls = c === 'connected' ? 'ok' : c === 'reconnecting' ? 'warn' : 'down';
  const label = c === 'connected' ? t('connected') : c === 'reconnecting' ? t('reconnecting') : t('disconnected');
  return (
    <button className={'conn-chip ' + cls} onClick={() => dispatch({ type:'openModal', modal:{ type:'qr' } })} title="WhatsApp">
      <span className="conn-dot" />
      <Icon name="whatsapp" size={15} />
      <span>{label}</span>
      {c !== 'connected' && <span style={{ fontWeight:700, marginLeft:2 }}>· {c === 'reconnecting' ? '' : t('reconnect')}</span>}
    </button>
  );
}

function TopBar() {
  const { state, dispatch } = useApp();
  const t = useT();
  const notifs = [
    { icon:'whatsapp', tone:'wa',  title: state.lang==='es'?'Nuevo mensaje de Carlos Mendoza':'New message from Carlos Mendoza', time:'2m' },
    { icon:'swap',     tone:'blue',title: state.lang==='es'?'Diego te transfirió un chat':'Diego transferred you a chat', time:'14m' },
    { icon:'status',   tone:'green',title: state.lang==='es'?'Pedido HIR-1040 marcado Listo':'Order HIR-1040 marked Ready', time:'1h' },
  ];
  return (
    <header className="topbar">
      <div className="topbar-search">
        <div className="field field-filled">
          <Icon name="search"/>
          <input placeholder={t('search_ph')} value={state.search} onChange={e => dispatch({ type:'setSearch', value:e.target.value })}/>
        </div>
      </div>
      <span className="grow" />
      <ConnectionChip />
      <div className="seg" style={{ height:34 }}>
        <button className={state.lang==='es'?'on':''} onClick={() => dispatch({ type:'setLang', lang:'es' })}>ES</button>
        <button className={state.lang==='en'?'on':''} onClick={() => dispatch({ type:'setLang', lang:'en' })}>EN</button>
      </div>
      <button className="iconbtn tip" data-tip={state.theme==='dark'?t('light'):t('dark')} onClick={() => dispatch({ type:'setTheme', theme: state.theme==='dark'?'light':'dark' })}>
        <Icon name={state.theme==='dark'?'sun':'moon'}/>
      </button>
      <Popover align="right" trigger={(open, tog) => (
        <button className="iconbtn" onClick={tog} style={{ position:'relative' }}>
          <Icon name="bell"/>
          <span className="badge badge-red" style={{ position:'absolute', top:3, right:4 }}>3</span>
        </button>
      )}>
        <div style={{ minWidth:300 }}>
          <div className="menu-label">{state.lang==='es'?'Notificaciones':'Notifications'}</div>
          {notifs.map((n, i) => (
            <button className="menu-item" key={i} style={{ alignItems:'flex-start' }}>
              <span className={'t-ic ' + n.tone} style={{ width:30, height:30, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name={n.icon} size={15}/></span>
              <span style={{ minWidth:0 }}><span style={{ display:'block', fontWeight:600, whiteSpace:'normal' }}>{n.title}</span><span className="t-xs muted">{n.time}</span></span>
            </button>
          ))}
        </div>
      </Popover>
      <button className="btn btn-primary" onClick={() => dispatch({ type:'openModal', modal:{ type:'newOrder' } })}>
        <Icon name="plus"/> <span className="hide-narrow">{t('new_order')}</span>
      </button>
    </header>
  );
}

Object.assign(window, { NavRail, TopBar, ConnectionChip });
