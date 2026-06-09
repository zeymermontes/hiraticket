/* ============================================================
   HIRATICKET — App state, reducer, root
   ============================================================ */

const BRAND_THEMES = {
  '#F5C518': null, // default (yellow) — uses tokens.css values
  '#0D9488': { on:'#fff', v:{ '--brand':'#0D9488','--brand-600':'#0B7C72','--brand-700':'#0A6B62','--brand-300':'#5EC9BF','--brand-100':'#C9EEEA','--brand-50':'#E6F6F4' } },
  '#4F46E5': { on:'#fff', v:{ '--brand':'#4F46E5','--brand-600':'#4338CA','--brand-700':'#3730A3','--brand-300':'#A5A0F0','--brand-100':'#DEDCFB','--brand-50':'#EEEDFD' } },
  '#EA580C': { on:'#fff', v:{ '--brand':'#EA580C','--brand-600':'#C2410C','--brand-700':'#9A3412','--brand-300':'#F6A977','--brand-100':'#FCDCC4','--brand-50':'#FDEFE5' } },
};

const LS = (k, d) => { try { const v = localStorage.getItem('ht_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const saveLS = (k, v) => { try { localStorage.setItem('ht_' + k, JSON.stringify(v)); } catch (e) {} };

let toastSeq = 0;
const nowTime = () => { const d = new Date(); return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'); };

function initState() {
  return {
    authed:   LS('authed', true),
    lang:     LS('lang', 'es'),
    theme:    LS('theme', 'light'),
    density:  LS('density', 'comfortable'),
    brand:    LS('brand', '#F5C518'),
    currentUser: window.HT.ME,
    route: 'chat',
    connection: 'connected',
    search: '',
    conversations: JSON.parse(JSON.stringify(window.HT.CONVERSATIONS)),
    orders: JSON.parse(JSON.stringify(window.HT.ORDERS)).map(o => ({ ...o, pay: o.status==='delivered'?'paid':o.status==='ready'?'partial':'pending' })),
    automations: JSON.parse(JSON.stringify(window.HT.AUTOMATIONS)),
    appointments: JSON.parse(JSON.stringify(window.HT.APPTS)),
    campaigns: JSON.parse(JSON.stringify(window.HT.CAMPAIGNS)),
    config: (function(){ try { const v = JSON.parse(localStorage.getItem('ht_vertical')||'null'); return v ? window.HT.configFromVertical(v) : window.HT.defaultConfig(); } catch(e){ return window.HT.defaultConfig(); } })(),
    selectedConvId: 'v1',
    chatTab: 'mine',
    chatExpanded: false,
    ctxVisible: true,
    convFilters: { status:null, area:null, agent:null, unreadOnly:false, q:'' },
    selectedOrderId: null,
    orderFrom: null,
    selectedOrderIds: [],
    orderFilters: { status:null, area:null, assignee:null, priority:null, q:'' },
    orderSort: { key:'created', dir:'desc' },
    kanbanGroup: 'status',
    kanbanFilters: { area:null, agent:null, q:'' },
    modal: null,
    toasts: [],
  };
}

function pushToast(toasts, t) { return [...toasts, Object.assign({ id: ++toastSeq }, t)].slice(-4); }

function reducer(state, a) {
  const tr = (k) => window.tr(k, state.lang);
  switch (a.type) {
    case 'signIn':  saveLS('authed', true);  return { ...state, authed:true };
    case 'signOut': saveLS('authed', false); return { ...state, authed:false, modal:null };
    case 'setLang':    saveLS('lang', a.lang);       return { ...state, lang:a.lang };
    case 'setTheme':   saveLS('theme', a.theme);     return { ...state, theme:a.theme };
    case 'setDensity': saveLS('density', a.density); return { ...state, density:a.density };
    case 'setBrand':   saveLS('brand', a.brand);     return { ...state, brand:a.brand };
    case 'navigate':   return { ...state, route:a.route };
    case 'setSearch':  return { ...state, search:a.value };
    case 'setConnection': return { ...state, connection:a.connection };

    /* chat */
    case 'selectConv': return { ...state, selectedConvId:a.id, chatExpanded:false, conversations: state.conversations.map(c => c.id===a.id ? { ...c, unread:0 } : c) };
    case 'setChatExpanded': return { ...state, chatExpanded:a.value };
    case 'toggleCtx': return { ...state, ctxVisible: !state.ctxVisible };
    case 'setChatTab': return { ...state, chatTab:a.tab };
    case 'setConvFilter': return { ...state, convFilters:{ ...state.convFilters, ...a.patch } };
    case 'sendMessage': {
      const conversations = state.conversations.map(c => {
        if (c.id !== a.convId) return c;
        const msg = { id:'m'+Date.now(), dir:'out', type:'text', body:{ en:a.text, es:a.text }, time:nowTime(), state:'sent', author:state.currentUser };
        return { ...c, messages:[...c.messages, msg], preview:{ en:a.text, es:a.text }, time:tr('now') };
      });
      return { ...state, conversations };
    }
    case 'acceptConv': {
      const conversations = state.conversations.map(c => c.id===a.convId ? { ...c, assignee:state.currentUser, events:[...c.events, { ic:'user', text:{ en:'Accepted by you', es:'Aceptado por ti' }, time:tr('now') }] } : c);
      return { ...state, conversations, toasts: pushToast(state.toasts, { icon:'check', tone:'green', title: state.lang==='es'?'Chat aceptado':'Chat accepted' }) };
    }
    case 'setConvStatus': {
      const resolved = a.status === 'resolved';
      const conversations = state.conversations.map(c => c.id===a.convId ? { ...c, status:a.status, unread: resolved?0:c.unread, events:[...c.events, { ic: resolved?'check':'clock', text:{ en:'Status → '+a.status, es:'Estado → '+window.tr(window.HT.CONV_STATUS[a.status].key,'es') }, time:tr('now') }] } : c);
      return { ...state, conversations, toasts: pushToast(state.toasts, { icon: resolved?'check':'status', tone: resolved?'green':'blue', title: resolved?tr('toast_resolved'):tr('toast_status') }) };
    }
    case 'resolveConv': {
      const conversations = state.conversations.map(c => c.id===a.convId ? { ...c, status:'resolved', unread:0, events:[...c.events, { ic:'check', text:{ en:'Resolved by you', es:'Resuelto por ti' }, time:tr('now') }] } : c);
      return { ...state, conversations, toasts: pushToast(state.toasts, { icon:'check', tone:'green', title: tr('toast_resolved') }) };
    }
    case 'addNote': {
      const note = { author:state.currentUser, time:{ en:'now', es:'ahora' }, body:{ en:a.body, es:a.body } };
      if (a.target.kind === 'conversation') {
        const conversations = state.conversations.map(c => c.id===a.target.id ? { ...c, notes:[...c.notes, note] } : c);
        return { ...state, conversations, toasts: pushToast(state.toasts, { icon:'edit', title: tr('toast_note') }) };
      }
      const orders = state.orders.map(o => o.id===a.target.id ? { ...o, notes:[...o.notes, note] } : o);
      return { ...state, orders, toasts: pushToast(state.toasts, { icon:'edit', title: tr('toast_note') }) };
    }

    /* transfer (conversation | order | orders) */
    case 'transfer': {
      const ev = { ic:'swap', actor:state.currentUser, text:{ en:'Transferred → '+a.destName, es:'Transferido → '+a.destName }, time: tr('now') };
      let conversations = state.conversations, orders = state.orders;
      const apply = (obj) => a.mode==='agent' ? { ...obj, assignee:a.dest, area: window.HT.agentById(a.dest).area || obj.area, events:[...obj.events, ev] } : { ...obj, area:a.dest, assignee: ((state.config.areas.find(x=>x.id===a.dest)||{}).routeTo) || null, events:[...obj.events, ev] };
      if (a.target.kind === 'conversation') conversations = conversations.map(c => c.id===a.target.id ? apply(c) : c);
      else if (a.target.kind === 'order') orders = orders.map(o => o.id===a.target.id ? apply(o) : o);
      else if (a.target.kind === 'orders') orders = orders.map(o => a.target.ids.includes(o.id) ? apply(o) : o);
      return { ...state, conversations, orders, selectedOrderIds: a.target.kind==='orders'?[]:state.selectedOrderIds, toasts: pushToast(state.toasts, { icon:'swap', tone:'blue', title: tr('toast_transferred'), sub: a.destName }) };
    }

    /* orders */
    case 'selectOrder': return { ...state, selectedOrderId:a.id, orderFrom:a.from };
    case 'closeOrder':  return { ...state, selectedOrderId:null };
    case 'toggleOrderSel': return { ...state, selectedOrderIds: state.selectedOrderIds.includes(a.id) ? state.selectedOrderIds.filter(x=>x!==a.id) : [...state.selectedOrderIds, a.id] };
    case 'selectAllOrders': return { ...state, selectedOrderIds:a.ids };
    case 'setOrderFilter': return { ...state, orderFilters:{ ...state.orderFilters, ...a.patch } };
    case 'setOrderSort': return { ...state, orderSort:{ key:a.key, dir: state.orderSort.key===a.key && state.orderSort.dir==='desc' ? 'asc':'desc' } };
    case 'moveOrderStatus': {
      const order = state.orders.find(o => o.id===a.id);
      let orders = state.orders.map(o => o.id===a.id ? { ...o, status:a.status, updated:{ en:'now', es:'ahora' }, events:[...o.events, { ic:'status', actor:state.currentUser, text:{ en:'Status → '+window.tr(window.HT.orderStatusById(a.status).key,'en'), es:'Estado → '+window.tr(window.HT.orderStatusById(a.status).key,'es') }, time:{ en:'now', es:'ahora' } }] } : o);
      let conversations = state.conversations;
      let automations = state.automations;
      let toasts = a.silent ? state.toasts : pushToast(state.toasts, { icon:'status', tone:'green', title: tr('toast_status'), sub: window.tr(window.HT.orderStatusById(a.status).key, state.lang) });
      // fire matching automation
      const auto = state.automations.find(w => w.enabled && w.trigger.type==='order_status' && w.trigger.value===a.status);
      if (auto && order) {
        automations = state.automations.map(w => w.id===auto.id ? { ...w, runs:w.runs+1 } : w);
        if (auto.action.type==='send_template' && order.convId) {
          const contact = window.HT.contactById(order.contactId);
          const tpl = window.HT.cannedById(auto.action.template);
          const body = window.L(tpl.body, state.lang).replace(/\{\{name\}\}/g, (contact.name||'').split(' ')[0]).replace(/\{\{order_number\}\}/g, order.code).replace(/\{\{total\}\}/g, window.HT.money(order.total)+' MXN');
          conversations = state.conversations.map(c => c.id===order.convId ? { ...c, messages:[...c.messages, { id:'m'+Date.now(), dir:'out', type:'text', body:{ en:body, es:body }, time:nowTime(), state:'sent', author:state.currentUser, auto:true }], preview:{ en:body, es:body }, time:tr('now') } : c);
          toasts = pushToast(toasts, { icon:'bolt', tone:'brand', title: tr('automation_ran'), sub: window.L(auto.name, state.lang) });
        } else if (auto.action.type==='transfer_area') {
          orders = orders.map(o => o.id===a.id ? { ...o, area:auto.action.area } : o);
          toasts = pushToast(toasts, { icon:'bolt', tone:'brand', title: tr('automation_ran'), sub: window.L(auto.name, state.lang) });
        } else if (auto.action.type==='notify_agent' || auto.action.type==='assign_agent' || auto.action.type==='add_tag') {
          toasts = pushToast(toasts, { icon:'bolt', tone:'brand', title: tr('automation_ran'), sub: window.L(auto.name, state.lang) });
        }
      }
      return { ...state, orders, conversations, automations, toasts };
    }
    case 'toggleAutomation': return { ...state, automations: state.automations.map(w => w.id===a.id ? { ...w, enabled: !w.enabled } : w) };
    case 'deleteAutomation': return { ...state, automations: state.automations.filter(w => w.id!==a.id) };
    case 'saveAutomation': {
      const exists = state.automations.some(w => w.id===a.flow.id);
      const automations = exists ? state.automations.map(w => w.id===a.flow.id ? a.flow : w) : [a.flow, ...state.automations];
      return { ...state, automations, toasts: pushToast(state.toasts, { icon:'bolt', tone:'brand', title: state.lang==='es'?'Flujo guardado':'Automation saved', sub: window.L(a.flow.name, state.lang) }) };
    }
    case 'moveOrderArea': {
      const orders = state.orders.map(o => o.id===a.id ? { ...o, area:a.area, updated:{ en:'now', es:'ahora' }, events:[...o.events, { ic:'swap', actor:state.currentUser, text:{ en:'Moved to '+window.L(window.HT.areaById(a.area).name,'en'), es:'Movido a '+window.L(window.HT.areaById(a.area).name,'es') }, time:{ en:'now', es:'ahora' } }] } : o);
      return { ...state, orders, toasts: pushToast(state.toasts, { icon:'swap', tone:'blue', title: tr('toast_transferred'), sub: window.L(window.HT.areaById(a.area).name, state.lang) }) };
    }
    case 'createOrder': {
      const n = state.orders.length;
      const code = 'HIR-' + (1043 + (n - 12 < 0 ? 0 : n - 12) + 1);
      const order = {
        id:'o'+Date.now(), code: 'HIR-'+(1043 + n), contactId:a.contactId, status:'new', area:a.area, assignee:state.currentUser, priority:a.priority,
        convId: state.conversations.find(c=>c.contactId===a.contactId)?.id || null, tags:[],
        created:{ en:'now', es:'ahora' }, updated:{ en:'now', es:'ahora' }, sortCreated:99,
        items:[{ name:{ en:a.item, es:a.item }, qty:a.qty, unit:a.price, sub:a.qty*a.price }], total:a.qty*a.price,
        events:[{ ic:'plus', actor:state.currentUser, text:{ en:'Order created', es:'Pedido creado' }, time:{ en:'now', es:'ahora' } }], notes:[],
      };
      return { ...state, orders:[order, ...state.orders], toasts: pushToast(state.toasts, { icon:'orders', title: tr('toast_order'), sub: order.code }) };
    }

    /* kanban */
    case 'setKanbanGroup': return { ...state, kanbanGroup:a.group };
    case 'setKanbanFilter': return { ...state, kanbanFilters:{ ...state.kanbanFilters, ...a.patch } };

    /* modals + toasts */
    case 'openModal':  return { ...state, modal:a.modal };
    case 'closeModal': return { ...state, modal:null };
    case 'toast':      return { ...state, toasts: pushToast(state.toasts, a.toast) };
    case 'dismissToast': return { ...state, toasts: state.toasts.filter(t => t.id !== a.id) };

    /* simulated incoming whatsapp */
    case 'simIncoming': {
      const candidates = state.conversations.filter(c => c.id !== state.selectedConvId && c.status !== 'resolved');
      if (!candidates.length) return state;
      const c0 = candidates[Math.floor(Math.random() * candidates.length)];
      const texts = state.lang==='es'
        ? ['¿Ya está listo mi pedido? 😊','Una pregunta más…','¿Aceptan transferencia?','Gracias!! 🙌','¿Cuándo lo puedo recoger?']
        : ['Is my order ready yet? 😊','One more question…','Do you take bank transfer?','Thanks!! 🙌','When can I pick it up?'];
      const body = texts[Math.floor(Math.random()*texts.length)];
      const contact = window.HT.contactById(c0.contactId);
      const conversations = state.conversations.map(c => c.id===c0.id ? { ...c, unread:(c.unread||0)+1, time: tr('now'), preview:{ en:body, es:body }, status: c.status==='resolved'?'open':c.status, messages:[...c.messages, { id:'m'+Date.now(), dir:'in', type:'text', body:{ en:body, es:body }, time:nowTime(), state:'delivered' }] } : c);
      return { ...state, conversations, toasts: pushToast(state.toasts, { icon:'whatsapp', tone:'wa', title: tr('toast_new_msg'), sub: contact.name + ': ' + body }) };
    }
    /* business config */
    case 'setVertical': { saveLS('vertical', a.id); return { ...state, config: window.HT.configFromVertical(a.id), toasts: pushToast(state.toasts, { icon:'check', tone:'green', title: tr('applied'), sub: window.L(window.HT.VERTICALS.find(v=>v.id===a.id).name, state.lang) }) }; }
    case 'setObjectName': return { ...state, config: { ...state.config, object: { en:a.value, es:a.value } } };
    case 'setStageName': return { ...state, config: { ...state.config, stages: state.config.stages.map(s => s.id===a.id ? { ...s, name:{ en:a.value, es:a.value } } : s) } };
    case 'setAreaName': return { ...state, config: { ...state.config, areas: state.config.areas.map(s => s.id===a.id ? { ...s, name:{ en:a.value, es:a.value } } : s) } };
    case 'setStageColor': return { ...state, config: { ...state.config, stages: state.config.stages.map(s => s.id===a.id ? { ...s, color:a.color } : s) } };
    case 'setAreaColor': return { ...state, config: { ...state.config, areas: state.config.areas.map(s => s.id===a.id ? { ...s, color:a.color } : s) } };
    case 'addStage': return { ...state, config: { ...state.config, stages: [...state.config.stages, { id:'st'+Date.now(), name:{ en:a.value||'Stage', es:a.value||'Etapa' }, color:a.color||'slate' }] } };
    case 'addArea': return { ...state, config: { ...state.config, areas: [...state.config.areas, { id:'ar'+Date.now(), name:{ en:a.value||'Area', es:a.value||'Área' }, color:a.color||'slate' }] } };
    case 'setAreaRoute': return { ...state, config: { ...state.config, areas: state.config.areas.map(s => s.id===a.id ? { ...s, routeTo:a.agent||null } : s) } };
    case 'removeStage': return { ...state, config: { ...state.config, stages: state.config.stages.length>2 ? state.config.stages.filter(s=>s.id!==a.id) : state.config.stages } };
    case 'removeArea': return { ...state, config: { ...state.config, areas: state.config.areas.length>1 ? state.config.areas.filter(s=>s.id!==a.id) : state.config.areas } };
    case 'addField': return { ...state, config: { ...state.config, fields: [...state.config.fields, { en:a.value||'Field', es:a.value||'Campo' }] } };
    case 'removeField': return { ...state, config: { ...state.config, fields: state.config.fields.filter((_,i)=>i!==a.index) } };

    /* payments */
    case 'chargeOrder': {
      const order = state.orders.find(o=>o.id===a.id);
      let conversations = state.conversations;
      if (order && order.convId) {
        const contact = window.HT.contactById(order.contactId);
        const body = state.lang==='es'
          ? `Hola ${(contact.name||'').split(' ')[0]} 👋 aquí está tu link de pago para el pedido ${order.code} por ${window.HT.money(order.total)} MXN: pay.hiraticket.com/${order.code.toLowerCase()} 💳`
          : `Hi ${(contact.name||'').split(' ')[0]} 👋 here's your payment link for order ${order.code} for ${window.HT.money(order.total)} MXN: pay.hiraticket.com/${order.code.toLowerCase()} 💳`;
        conversations = state.conversations.map(c => c.id===order.convId ? { ...c, messages:[...c.messages, { id:'m'+Date.now(), dir:'out', type:'text', body:{ en:body, es:body }, time:nowTime(), state:'sent', author:state.currentUser }], preview:{ en:body, es:body }, time:tr('now') } : c);
      }
      return { ...state, conversations, toasts: pushToast(state.toasts, { icon:'orders', tone:'green', title: tr('pay_link_sent'), sub: order && order.code }) };
    }
    case 'markPaid': return { ...state, orders: state.orders.map(o=>o.id===a.id?{ ...o, pay:'paid' }:o), toasts: pushToast(state.toasts, { icon:'check', tone:'green', title: tr('pay_paid'), sub: state.orders.find(o=>o.id===a.id).code }) };

    /* agenda + campaigns */
    case 'createAppointment': return { ...state, appointments: [a.appt, ...state.appointments], toasts: pushToast(state.toasts, { icon:'calendar', tone:'blue', title: tr('new_appt') }) };
    case 'sendCampaign': return { ...state, toasts: pushToast(state.toasts, { icon:'send', tone:'brand', title: tr('campaign_sent'), sub: a.sub }) };

    default: return state;
  }
}

function ViewRouter() {
  const { state } = useApp();
  switch (state.route) {
    case 'chat':     return <ChatView />;
    case 'orders':   return <OrdersView />;
    case 'kanban':   return <KanbanView />;
    case 'flows':    return <AutomationsView />;
    case 'catalog':  return <CatalogView />;
    case 'agenda':   return <AgendaView />;
    case 'campaigns':return <CampaignsView />;
    case 'reports':  return <ReportsView />;
    case 'business': return <BusinessView />;
    case 'agents':   return <AgentsView />;
    case 'canned':   return <CannedView />;
    case 'settings': return <SettingsView />;
    default:         return <ChatView />;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  // apply theme + brand to DOM
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = state.theme;
    const bt = BRAND_THEMES[state.brand];
    const keys = ['--brand','--brand-600','--brand-700','--brand-300','--brand-100','--brand-50','--on-brand'];
    keys.forEach(k => r.style.removeProperty(k));
    if (bt) { Object.entries(bt.v).forEach(([k,v]) => r.style.setProperty(k,v)); r.style.setProperty('--on-brand', bt.on); }
  }, [state.theme, state.brand]);

  // simulated real-time incoming messages
  useEffect(() => {
    if (!state.authed) return;
    const iv = setInterval(() => dispatch({ type:'simIncoming' }), 26000);
    return () => clearInterval(iv);
  }, [state.authed]);

  const ctx = useMemo(() => ({ state, dispatch }), [state]);

  if (!state.authed) {
    return <HTCtx.Provider value={ctx}><LoginView /><ToastHost /></HTCtx.Provider>;
  }

  return (
    <HTCtx.Provider value={ctx}>
      <div className="app">
        <NavRail />
        <div className="main">
          <TopBar />
          {state.connection === 'disconnected' && (
            <div className="drop-banner">
              <Icon name="wifioff" size={18} />
              <span className="grow">{window.tr('drop_banner', state.lang)}</span>
              <button className="btn btn-sm btn-danger" onClick={()=>dispatch({ type:'openModal', modal:{ type:'qr' } })}><Icon name="qr" size={14}/>{window.tr('scan_qr', state.lang)}</button>
            </div>
          )}
          <ViewRouter />
        </div>
        {state.selectedOrderId && <OrderDrawer />}
        <ModalRoot />
        <ToastHost />
      </div>
    </HTCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
