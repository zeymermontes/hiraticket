/* ============================================================
   HIRATICKET — Mock data (Hirata · sticker & print shop · MXN)
   All localized fields use {en, es}; rendered via window.L().
   ============================================================ */
(function () {
  const money = (n) => '$' + n.toLocaleString('es-MX') + ' MXN';

  /* ---- Meta tables ---- */
  const AREAS = [
    { id: 'ventas',     name: { en: 'Sales',      es: 'Ventas' },     color: 'brand'  },
    { id: 'diseno',     name: { en: 'Design',     es: 'Diseño' },     color: 'blue'   },
    { id: 'produccion', name: { en: 'Production', es: 'Producción' }, color: 'violet' },
    { id: 'envios',     name: { en: 'Shipping',   es: 'Envíos' },     color: 'teal'   },
  ];

  const CONV_STATUS = {
    open:     { key: 'st_open',     color: 'blue'  },
    pending:  { key: 'st_pending',  color: 'amber' },
    resolved: { key: 'st_resolved', color: 'green' },
  };

  const ORDER_STATUS = [
    { id: 'new',        key: 'os_new',        color: 'slate'  },
    { id: 'design',     key: 'os_design',     color: 'blue'   },
    { id: 'production', key: 'os_production', color: 'violet' },
    { id: 'ready',      key: 'os_ready',      color: 'teal'   },
    { id: 'delivered',  key: 'os_delivered',  color: 'green'  },
  ];
  const ORDER_STATUS_EXTRA = { cancelled: { id: 'cancelled', key: 'os_cancelled', color: 'red' } };

  const PRIORITY = {
    low:    { key: 'pr_low',    color: 'slate'  },
    med:    { key: 'pr_med',    color: 'blue'   },
    high:   { key: 'pr_high',   color: 'amber'  },
    urgent: { key: 'pr_urgent', color: 'red'    },
  };

  /* ---- Agents ---- */
  const AGENTS = [
    { id: 'a_mar', name: 'Mariana Ortiz',  initials: 'MO', color: '#C99A04', role: 'admin',  area: 'ventas',     presence: 'online',  openChats: 4, openOrders: 6, email: 'mariana@hirata.mx' },
    { id: 'a_die', name: 'Diego Salinas',  initials: 'DS', color: '#2563EB', role: 'agent',  area: 'diseno',     presence: 'online',  openChats: 3, openOrders: 5, email: 'diego@hirata.mx' },
    { id: 'a_pao', name: 'Paola Restrepo', initials: 'PR', color: '#6D45D6', role: 'agent',  area: 'produccion', presence: 'away',    openChats: 1, openOrders: 8, email: 'paola@hirata.mx' },
    { id: 'a_bru', name: 'Bruno Tanaka',   initials: 'BT', color: '#0E8C82', role: 'agent',  area: 'envios',     presence: 'online',  openChats: 2, openOrders: 3, email: 'bruno@hirata.mx' },
    { id: 'a_sof', name: 'Sofía Méndez',   initials: 'SM', color: '#CF3D3D', role: 'agent',  area: 'ventas',     presence: 'online',  openChats: 5, openOrders: 4, email: 'sofia@hirata.mx' },
    { id: 'a_hir', name: 'Hiro Nakamura',  initials: 'HN', color: '#5A6373', role: 'viewer', area: null,         presence: 'offline', openChats: 0, openOrders: 0, email: 'hiro@hirata.mx' },
  ];
  const ME = 'a_mar';

  /* ---- Contacts ---- */
  const CONTACTS = [
    { id: 'c1', name: 'Lucía Fernández',    phone: '+52 55 1432 8890', initials: 'LF', color: '#C2410C', tags: ['Mayoreo'],            lifetime: 8430,  firstSeen: { en: 'Mar 2024', es: 'Mar 2024' } },
    { id: 'c2', name: 'Repostería La Abeja',phone: '+52 33 2210 4567', initials: 'LA', color: '#A9740B', tags: ['Negocio','Recurrente'],lifetime: 23900, firstSeen: { en: 'Jan 2024', es: 'Ene 2024' } },
    { id: 'c3', name: 'Carlos Mendoza',     phone: '+52 81 3398 1122', initials: 'CM', color: '#2563EB', tags: [],                     lifetime: 1240,  firstSeen: { en: 'May 2026', es: 'May 2026' } },
    { id: 'c4', name: 'Tacos El Güero',     phone: '+52 55 7781 2390', initials: 'TG', color: '#CF3D3D', tags: ['Negocio'],            lifetime: 5600,  firstSeen: { en: 'Sep 2025', es: 'Sep 2025' } },
    { id: 'c5', name: 'Andrea Villaseñor',  phone: '+52 55 6620 7745', initials: 'AV', color: '#6D45D6', tags: ['Diseñadora'],         lifetime: 12750, firstSeen: { en: 'Nov 2024', es: 'Nov 2024' } },
    { id: 'c6', name: 'Gimnasio IronFit',   phone: '+52 55 9043 1187', initials: 'IF', color: '#0E8C82', tags: ['Negocio','Mayoreo'],  lifetime: 18200, firstSeen: { en: 'Feb 2025', es: 'Feb 2025' } },
    { id: 'c7', name: 'Pablo Reséndiz',     phone: '+52 55 3367 9921', initials: 'PR', color: '#1A8F4C', tags: [],                     lifetime: 430,   firstSeen: { en: 'Jun 2026', es: 'Jun 2026' } },
    { id: 'c8', name: 'Floristería Dalia',  phone: '+52 33 5582 6610', initials: 'FD', color: '#DB2777', tags: ['Negocio'],            lifetime: 7320,  firstSeen: { en: 'Aug 2025', es: 'Ago 2025' } },
  ];

  /* ---- Helper to build messages ---- */
  let mid = 0;
  const m = (dir, type, body, time, state, extra) => Object.assign({ id: 'm' + (++mid), dir, type, body, time, state: state || 'read' }, extra || {});

  /* ---- Conversations ---- */
  const CONVERSATIONS = [
    {
      id: 'v1', contactId: 'c1', status: 'open', assignee: ME, area: 'ventas', unread: 0, sortTs: 2,
      preview: { en: 'Perfect, send me the quote 🙏', es: 'Perfecto, mándame la cotización 🙏' },
      time: '10:24',
      messages: [
        { day: { en: 'Today', es: 'Hoy' } },
        m('in','text',{ en: 'Hi! Do you make die-cut holographic stickers?', es: 'Hola! ¿Hacen stickers troquelados holográficos?' },'10:02'),
        m('out','text',{ en: 'Hi Lucía! Yes 🙌 holographic, matte, and transparent. What size and quantity?', es: '¡Hola Lucía! Sí 🙌 holográfico, mate y transparente. ¿Qué tamaño y cantidad?' },'10:05',null,{ author:'a_mar' }),
        m('in','image',{ en: '', es: '' },'10:09',null,{ mediaCaption:{ en:'reference.png', es:'referencia.png' } }),
        m('in','text',{ en: 'Like this, 5×5cm, 500 pieces', es: 'Algo así, 5×5cm, 500 piezas' },'10:10'),
        m('out','text',{ en: 'Got it. 500 die-cut holographic 5×5cm = $1,450 MXN, ready in 4 business days.', es: 'Va. 500 troquelados holográficos 5×5cm = $1,450 MXN, listos en 4 días hábiles.' },'10:20',null,{ author:'a_mar' }),
        m('in','text',{ en: 'Perfect, send me the quote 🙏', es: 'Perfecto, mándame la cotización 🙏' },'10:24','delivered'),
      ],
      notes: [
        { author:'a_sof', time:{ en:'9:58', es:'9:58' }, body:{ en:'Wholesale client — give the recurring 10% if she takes 1,000.', es:'Cliente de mayoreo — dale el 10% de recurrente si se lleva 1,000.' } },
      ],
      events: [
        { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'10:02' },
        { ic:'user', text:{ en:'Assigned to Mariana Ortiz', es:'Asignado a Mariana Ortiz' }, time:'10:03' },
      ],
    },
    {
      id: 'v2', contactId: 'c2', status: 'pending', assignee: 'a_die', area: 'diseno', unread: 2, sortTs: 5,
      preview: { en: 'Can you tweak the logo a bit bigger?', es: '¿Pueden poner el logo un poco más grande?' },
      time: '10:12',
      messages: [
        { day: { en: 'Today', es: 'Hoy' } },
        m('out','text',{ en: 'Here is the first proof for your product labels 🐝', es: 'Aquí está la primera prueba de tus etiquetas 🐝' },'09:40',null,{ author:'a_die' }),
        m('out','image',{ en:'', es:'' },'09:40',null,{ mediaCaption:{ en:'proof-v1.pdf', es:'prueba-v1.pdf' } }),
        m('in','text',{ en: 'Looks great! Can you tweak the logo a bit bigger?', es: '¡Se ve genial! ¿Pueden poner el logo un poco más grande?' },'10:12','delivered'),
      ],
      notes: [],
      events: [
        { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'09:30' },
        { ic:'swap', text:{ en:'Transferred Sales → Design', es:'Transferido Ventas → Diseño' }, time:'09:38' },
        { ic:'clock', text:{ en:'Marked pending', es:'Marcado pendiente' }, time:'10:12' },
      ],
    },
    {
      id: 'v3', contactId: 'c3', status: 'open', assignee: null, area: 'ventas', unread: 1, sortTs: 8,
      preview: { en: 'How much for 1000 business cards?', es: '¿Cuánto por 1000 tarjetas de presentación?' },
      time: '09:55',
      messages: [
        { day: { en: 'Today', es: 'Hoy' } },
        m('in','text',{ en: 'Good morning, how much for 1000 business cards?', es: 'Buen día, ¿cuánto por 1000 tarjetas de presentación?' },'09:55','delivered'),
      ],
      notes: [],
      events: [ { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'09:55' } ],
    },
    {
      id: 'v4', contactId: 'c4', status: 'open', assignee: ME, area: 'produccion', unread: 0, sortTs: 12,
      preview: { en: 'Audio · 0:14', es: 'Audio · 0:14' },
      time: 'Ayer',
      messages: [
        { day: { en: 'Yesterday', es: 'Ayer' } },
        m('in','text',{ en: 'The menu vinyl, is it ready?', es: 'El vinil del menú, ¿ya está?' },'17:20'),
        m('out','text',{ en: 'Printing now, ready tomorrow at noon 👍', es: 'Imprimiéndolo ahora, listo mañana al mediodía 👍' },'17:25',null,{ author:'a_mar' }),
        m('in','audio',{ en:'', es:'' },'17:31',null,{ duration:'0:14' }),
      ],
      notes: [
        { author:'a_pao', time:{ en:'Ayer 16:00', es:'Ayer 16:00' }, body:{ en:'Large-format printer queue is long — confirm noon is realistic.', es:'La cola del plotter está larga — confirma que el mediodía sea realista.' } },
      ],
      events: [ { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'Ayer 17:20' } ],
    },
    {
      id: 'v5', contactId: 'c6', status: 'open', assignee: 'a_sof', area: 'ventas', unread: 0, sortTs: 18,
      preview: { en: 'Need 200 gym member decals', es: 'Necesito 200 calcomanías para socios' },
      time: 'Ayer',
      messages: [
        { day: { en: 'Yesterday', es: 'Ayer' } },
        m('in','text',{ en: 'Hey! Need 200 gym member decals for the new branch', es: '¡Qué tal! Necesito 200 calcomanías para socios de la nueva sucursal' },'14:02'),
        m('out','text',{ en: 'On it 💪 sending you the wholesale price now.', es: 'Va 💪 te paso el precio de mayoreo ahora.' },'14:10',null,{ author:'a_sof' }),
      ],
      notes: [], events: [ { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'Ayer 14:02' } ],
    },
    {
      id: 'v6', contactId: 'c5', status: 'resolved', assignee: 'a_die', area: 'diseno', unread: 0, sortTs: 30,
      preview: { en: 'Thank you! 🙌', es: '¡Gracias! 🙌' },
      time: 'Lun',
      messages: [
        { day: { en: 'Monday', es: 'Lunes' } },
        m('out','text',{ en: 'Your sticker pack files are approved and queued ✅', es: 'Tus archivos del pack de stickers están aprobados y en cola ✅' },'11:00',null,{ author:'a_die' }),
        m('in','text',{ en: 'Thank you! 🙌', es: '¡Gracias! 🙌' },'11:05'),
      ],
      notes: [], events: [
        { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'Lun 10:30' },
        { ic:'check', text:{ en:'Resolved by Diego Salinas', es:'Resuelto por Diego Salinas' }, time:'Lun 11:06' },
      ],
    },
    {
      id: 'v7', contactId: 'c8', status: 'pending', assignee: null, area: 'envios', unread: 3, sortTs: 35,
      preview: { en: 'Document · guia-envio.pdf', es: 'Documento · guia-envio.pdf' },
      time: 'Lun',
      messages: [
        { day: { en: 'Monday', es: 'Lunes' } },
        m('in','text',{ en: 'Did my banner ship already?', es: '¿Ya se envió mi lona?' },'12:40','delivered'),
        m('in','doc',{ en:'', es:'' },'12:41','delivered',{ docName:'guia-envio.pdf' }),
        m('in','text',{ en: 'This is the address again', es: 'Esta es la dirección otra vez' },'12:41','delivered'),
      ],
      notes: [], events: [ { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'Lun 12:40' } ],
    },
    {
      id: 'v8', contactId: 'c7', status: 'open', assignee: ME, area: 'ventas', unread: 0, sortTs: 40,
      preview: { en: 'Just my first order, a sticker sheet', es: 'Solo mi primer pedido, una hoja de stickers' },
      time: 'Lun',
      messages: [
        { day: { en: 'Monday', es: 'Lunes' } },
        m('in','text',{ en: 'Hi, first time ordering — one A4 sticker sheet please', es: 'Hola, primera vez pidiendo — una hoja A4 de stickers por favor' },'15:10'),
        m('out','text',{ en: 'Welcome! 🎉 A4 kiss-cut sheet is $90 MXN. Upload your design and we validate it.', es: '¡Bienvenido! 🎉 La hoja A4 kiss-cut es $90 MXN. Sube tu diseño y lo validamos.' },'15:14',null,{ author:'a_mar' }),
      ],
      notes: [], events: [ { ic:'plus', text:{ en:'Conversation opened', es:'Conversación abierta' }, time:'Lun 15:10' } ],
    },
  ];

  /* ---- Orders ---- */
  const it = (name, qty, unit) => ({ name, qty, unit, sub: qty * unit });
  const ORDERS = [
    { id:'o1', code:'HIR-1042', contactId:'c1', status:'production', area:'produccion', assignee:'a_pao', priority:'high', convId:'v1', tags:['Mayoreo'],
      created:{ en:'Jun 6', es:'6 Jun' }, updated:{ en:'2h ago', es:'hace 2h' }, sortCreated:6,
      items:[ it({en:'Die-cut holographic stickers 5×5cm', es:'Stickers troquelados holográficos 5×5cm'}, 500, 2.9) ], total:1450 },
    { id:'o2', code:'HIR-1041', contactId:'c2', status:'design', area:'diseno', assignee:'a_die', priority:'med', convId:'v2', tags:['Negocio','Recurrente'],
      created:{ en:'Jun 6', es:'6 Jun' }, updated:{ en:'18m ago', es:'hace 18m' }, sortCreated:6,
      items:[ it({en:'Product labels (roll)', es:'Etiquetas para producto (rollo)'}, 2000, 0.85), it({en:'Setup & proof', es:'Setup y prueba'}, 1, 250) ], total:1950 },
    { id:'o3', code:'HIR-1040', contactId:'c4', status:'ready', area:'produccion', assignee:'a_pao', priority:'urgent', convId:'v4', tags:['Negocio'],
      created:{ en:'Jun 5', es:'5 Jun' }, updated:{ en:'1h ago', es:'hace 1h' }, sortCreated:5,
      items:[ it({en:'Printed menu vinyl 1×0.6m', es:'Vinil de menú impreso 1×0.6m'}, 2, 480) ], total:960 },
    { id:'o4', code:'HIR-1039', contactId:'c6', status:'new', area:'ventas', assignee:'a_sof', priority:'med', convId:'v5', tags:['Mayoreo'],
      created:{ en:'Jun 5', es:'5 Jun' }, updated:{ en:'Yesterday', es:'Ayer' }, sortCreated:5,
      items:[ it({en:'Member decals (transfer vinyl)', es:'Calcomanías de socio (vinil de transfer)'}, 200, 14) ], total:2800 },
    { id:'o5', code:'HIR-1038', contactId:'c5', status:'delivered', area:'envios', assignee:'a_bru', priority:'low', convId:'v6', tags:['Diseñadora'],
      created:{ en:'Jun 2', es:'2 Jun' }, updated:{ en:'Jun 4', es:'4 Jun' }, sortCreated:2,
      items:[ it({en:'Sticker pack — kiss-cut sheets', es:'Pack de stickers — hojas kiss-cut'}, 50, 24), it({en:'National shipping', es:'Envío nacional'}, 1, 180) ], total:1380 },
    { id:'o6', code:'HIR-1037', contactId:'c8', status:'ready', area:'envios', assignee:'a_bru', priority:'high', convId:'v7', tags:['Negocio'],
      created:{ en:'Jun 1', es:'1 Jun' }, updated:{ en:'Jun 3', es:'3 Jun' }, sortCreated:1,
      items:[ it({en:'Printed banner 2×1m', es:'Lona impresa 2×1m'}, 1, 540), it({en:'Grommets & hem', es:'Ojillos y dobladillo'}, 1, 120) ], total:660 },
    { id:'o7', code:'HIR-1036', contactId:'c3', status:'new', area:'ventas', assignee:null, priority:'low', convId:'v3', tags:[],
      created:{ en:'Jun 6', es:'6 Jun' }, updated:{ en:'25m ago', es:'hace 25m' }, sortCreated:6,
      items:[ it({en:'Business cards, matte 350g', es:'Tarjetas de presentación, mate 350g'}, 1000, 0.65) ], total:650 },
    { id:'o8', code:'HIR-1035', contactId:'c7', status:'design', area:'diseno', assignee:'a_die', priority:'low', convId:'v8', tags:[],
      created:{ en:'Jun 3', es:'3 Jun' }, updated:{ en:'Yesterday', es:'Ayer' }, sortCreated:3,
      items:[ it({en:'A4 kiss-cut sticker sheet', es:'Hoja A4 de stickers kiss-cut'}, 1, 90) ], total:90 },
    { id:'o9', code:'HIR-1034', contactId:'c2', status:'delivered', area:'envios', assignee:'a_bru', priority:'med', convId:null, tags:['Recurrente'],
      created:{ en:'May 28', es:'28 May' }, updated:{ en:'Jun 1', es:'1 Jun' }, sortCreated:-2,
      items:[ it({en:'DTF t-shirts, full color', es:'Playeras DTF, full color'}, 20, 95) ], total:1900 },
    { id:'o10', code:'HIR-1033', contactId:'c1', status:'delivered', area:'envios', assignee:'a_bru', priority:'low', convId:null, tags:['Mayoreo'],
      created:{ en:'May 26', es:'26 May' }, updated:{ en:'May 30', es:'30 May' }, sortCreated:-4,
      items:[ it({en:'Transparent stickers 7×7cm', es:'Stickers transparentes 7×7cm'}, 300, 3.4) ], total:1020 },
    { id:'o11', code:'HIR-1032', contactId:'c6', status:'production', area:'produccion', assignee:'a_pao', priority:'med', convId:null, tags:['Negocio'],
      created:{ en:'Jun 4', es:'4 Jun' }, updated:{ en:'3h ago', es:'hace 3h' }, sortCreated:4,
      items:[ it({en:'Half-letter flyers, glossy', es:'Volantes media carta, brillante'}, 1000, 0.9) ], total:900 },
    { id:'o12', code:'HIR-1031', contactId:'c4', status:'new', area:'ventas', assignee:'a_sof', priority:'low', convId:null, tags:['Negocio'],
      created:{ en:'Jun 6', es:'6 Jun' }, updated:{ en:'40m ago', es:'hace 40m' }, sortCreated:6,
      items:[ it({en:'Car decals, die-cut', es:'Calcomanías para auto, troqueladas'}, 12, 35) ], total:420 },
  ];

  // attach simple activity logs + notes to orders
  ORDERS.forEach((o) => {
    o.events = o.events || [
      { ic:'plus',  actor:o.assignee||'a_mar', text:{ en:'Order created', es:'Pedido creado' }, time:o.created },
      { ic:'swap',  actor:'a_mar', text:{ en:'Routed to '+window.L(AREAS.find(a=>a.id===o.area).name,'en'), es:'Ruteado a '+window.L(AREAS.find(a=>a.id===o.area).name,'es') }, time:o.created },
      { ic:'status',actor:o.assignee||'a_mar', text:{ en:'Status → '+o.status, es:'Estado → '+o.status }, time:o.updated },
    ];
    o.notes = o.notes || [];
  });

  /* ---- Canned messages ---- */
  const CANNED = [
    { id:'k1', category:'cat_greetings', shortcut:'/hola', title:{ en:'Greeting', es:'Saludo' },
      body:{ en:'Hi {{name}}! 👋 Thanks for reaching Hirata. How can we help with your stickers or prints today?', es:'¡Hola {{name}}! 👋 Gracias por escribir a Hirata. ¿En qué te ayudamos hoy con tus stickers o impresiones?' } },
    { id:'k2', category:'cat_quote', shortcut:'/cotiza', title:{ en:'Send quote', es:'Enviar cotización' },
      body:{ en:'Here is your quote {{name}}: order {{order_number}} for a total of {{total}}. Ready in 4 business days once approved ✅', es:'Aquí tienes tu cotización {{name}}: pedido {{order_number}} por un total de {{total}}. Listo en 4 días hábiles tras aprobar ✅' } },
    { id:'k3', category:'cat_quote', shortcut:'/archivo', title:{ en:'File requirements', es:'Requisitos de archivo' },
      body:{ en:'For best quality send PDF, AI, or PNG at 300dpi with 3mm bleed. We validate before printing 🖨️', es:'Para mejor calidad envía PDF, AI o PNG a 300dpi con 3mm de rebase. Validamos antes de imprimir 🖨️' } },
    { id:'k4', category:'cat_payment', shortcut:'/pago', title:{ en:'Payment info', es:'Datos de pago' },
      body:{ en:'You can pay by transfer or card. 50% to start production, 50% on delivery. Want me to send the link?', es:'Puedes pagar por transferencia o tarjeta. 50% para iniciar producción, 50% al entregar. ¿Te mando el link?' } },
    { id:'k5', category:'cat_shipping', shortcut:'/envio', title:{ en:'Shipping update', es:'Aviso de envío' },
      body:{ en:'Your order {{order_number}} shipped 📦 here is your tracking guide. Delivery in 2–4 business days.', es:'Tu pedido {{order_number}} fue enviado 📦 aquí está tu guía de rastreo. Entrega en 2–4 días hábiles.' } },
    { id:'k6', category:'cat_shipping', shortcut:'/sucursal', title:{ en:'Pickup ready', es:'Listo para recoger' },
      body:{ en:'{{name}}, your order {{order_number}} is ready for pickup at our branch 🎉 Mon–Sat, 10am–7pm.', es:'{{name}}, tu pedido {{order_number}} está listo para recoger en sucursal 🎉 Lun–Sáb, 10am–7pm.' } },
    { id:'k7', category:'cat_closing', shortcut:'/gracias', title:{ en:'Thanks & close', es:'Gracias y cierre' },
      body:{ en:'Thanks for choosing Hirata, {{name}}! 🐝 Tag us in your designs. Anything else I can help with?', es:'¡Gracias por elegir Hirata, {{name}}! 🐝 Etiquétanos en tus diseños. ¿Algo más en que ayudarte?' } },
  ];
  const CANNED_VARS = ['name', 'order_number', 'total'];

  /* ---- Automations / workflows ---- */
  const TRIGGERS = [
    { id:'order_status', key:'trg_order_status', icon:'orders', param:'order_status' },
    { id:'conv_status',  key:'trg_conv_status',  icon:'status', param:'conv_status' },
    { id:'conv_created', key:'trg_conv_created', icon:'chat',   param:null },
    { id:'order_created',key:'trg_order_created',icon:'plus',   param:null },
  ];
  const ACTIONS = [
    { id:'send_template', key:'act_send_template', icon:'send',     param:'template' },
    { id:'transfer_area', key:'act_transfer_area', icon:'swap',     param:'area' },
    { id:'assign_agent',  key:'act_assign_agent',  icon:'user',     param:'agent' },
    { id:'add_tag',       key:'act_add_tag',       icon:'tag',      param:'tag' },
    { id:'notify_agent',  key:'act_notify_agent',  icon:'bell',     param:null },
  ];
  const AUTOMATIONS = [
    { id:'w1', name:{ en:'Order ready → notify customer', es:'Pedido listo → avisar al cliente' }, enabled:true, runs:124,
      trigger:{ type:'order_status', value:'ready' }, action:{ type:'send_template', template:'k6' } },
    { id:'w2', name:{ en:'New chat → auto greeting', es:'Nuevo chat → saludo automático' }, enabled:true, runs:340,
      trigger:{ type:'conv_created', value:null }, action:{ type:'send_template', template:'k1' } },
    { id:'w3', name:{ en:'Order delivered → thank you', es:'Pedido entregado → agradecer' }, enabled:true, runs:89,
      trigger:{ type:'order_status', value:'delivered' }, action:{ type:'send_template', template:'k7' } },
    { id:'w4', name:{ en:'Order in production → notify agent', es:'Pedido en producción → notificar agente' }, enabled:false, runs:58,
      trigger:{ type:'order_status', value:'production' }, action:{ type:'notify_agent', value:null } },
    { id:'w5', name:{ en:'In design → move to Design area', es:'En diseño → mover al área de Diseño' }, enabled:false, runs:12,
      trigger:{ type:'order_status', value:'design' }, action:{ type:'transfer_area', area:'diseno' } },
  ];

  window.HT = {
    money, AREAS, CONV_STATUS, ORDER_STATUS, ORDER_STATUS_EXTRA, PRIORITY,
    AGENTS, ME, CONTACTS, CONVERSATIONS, ORDERS, CANNED, CANNED_VARS,
    TRIGGERS, ACTIONS, AUTOMATIONS,
    areaById: (id) => AREAS.find(a => a.id === id),
    agentById: (id) => AGENTS.find(a => a.id === id) || null,
    contactById: (id) => CONTACTS.find(c => c.id === id),
    orderStatusById: (id) => ORDER_STATUS.find(s => s.id === id) || ORDER_STATUS_EXTRA[id],
    cannedById: (id) => CANNED.find(k => k.id === id),
    triggerById: (id) => TRIGGERS.find(x => x.id === id),
    actionById: (id) => ACTIONS.find(x => x.id === id),
  };
})();
