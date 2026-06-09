/* ============================================================
   HIRATICKET — Platform (super-admin) mock data
   Headline metrics reflect the full customer base (see plans.js
   subscribers); the tenants array is a representative sample.
   ============================================================ */
(function () {
  const money = (n) => '$' + Math.round(n).toLocaleString('es-MX');
  const moneyMXN = (n) => money(n) + ' MXN';

  const T = (id, name, ownerName, ini, color, plan, status, agents, numbers, wa, msgs, orders, joined, active, city) =>
    ({ id, name, owner: { name: ownerName, initials: ini, color, email: ownerName.toLowerCase().split(' ')[0] + '@' + id + '.mx' },
       plan, status, agents, numbers, wa, msgs, orders, joined, active, city });

  const TENANTS = [
    T('hirata',     'Hirata Impresión Digital', 'Mariana Ortiz',  'MO', '#C99A04', 'pro',     'active',   6,  2, 'connected',    4280, 142, { en:'Jan 2024', es:'Ene 2024' }, { en:'2m ago', es:'hace 2m' }, 'CDMX'),
    T('tacoguero',  'Tacos El Güero',           'Beto Ramírez',   'BR', '#CF3D3D', 'inicio',  'active',   2,  1, 'connected',     940,  38, { en:'Sep 2025', es:'Sep 2025' }, { en:'12m ago', es:'hace 12m' }, 'Guadalajara'),
    T('lunaria',    'Boutique Lunaria',         'Daniela Cruz',   'DC', '#DB2777', 'pro',     'active',   7,  2, 'connected',    3120, 96,  { en:'Mar 2025', es:'Mar 2025' }, { en:'1h ago', es:'hace 1h' }, 'Monterrey'),
    T('refadelnorte','Refaccionaria del Norte', 'Jorge Salas',    'JS', '#2563EB', 'negocio', 'active',   14, 3, 'connected',    8900, 410, { en:'Nov 2024', es:'Nov 2024' }, { en:'5m ago', es:'hace 5m' }, 'Saltillo'),
    T('esteticabella','Estética Bella',         'Karla Ibáñez',   'KI', '#6D45D6', 'inicio',  'trial',    1,  1, 'needs_qr',      120,   6,  { en:'5 days ago', es:'hace 5 días' }, { en:'3h ago', es:'hace 3h' }, 'Puebla'),
    T('vetpatitas', 'Veterinaria Patitas',      'Luis Mena',      'LM', '#0E8C82', 'pro',     'past_due', 4,  1, 'connected',    2640, 71,  { en:'Feb 2025', es:'Feb 2025' }, { en:'2h ago', es:'hace 2h' }, 'Querétaro'),
    T('cafearoma',  'Cafetería Aroma',          'Sofía Lara',     'SL', '#A9740B', 'inicio',  'active',   2,  1, 'connected',     760,  22,  { en:'Jun 2025', es:'Jun 2025' }, { en:'Yesterday', es:'Ayer' }, 'CDMX'),
    T('ironfit',    'Gimnasio IronFit',         'Marco Díaz',     'MD', '#16a34a', 'pro',     'active',   8,  2, 'disconnected',  3540, 88,  { en:'Feb 2025', es:'Feb 2025' }, { en:'4h ago', es:'hace 4h' }, 'Mérida'),
    T('dalia',      'Floristería Dalia',        'Rosa Delgado',   'RD', '#EA580C', 'inicio',  'active',   2,  1, 'connected',     680,  29,  { en:'Aug 2025', es:'Ago 2025' }, { en:'30m ago', es:'hace 30m' }, 'León'),
    T('pinata',     'Dulcería Piñata',          'Pablo Nava',     'PN', '#7c3aed', 'inicio',  'trial',    1,  1, 'connected',     210,  11,  { en:'2 days ago', es:'hace 2 días' }, { en:'1h ago', es:'hace 1h' }, 'Toluca'),
    T('tecnocel',   'TecnoCelular MX',          'Iván Robles',    'IR', '#0d9488', 'negocio', 'active',   22, 4, 'connected',   12400, 690, { en:'Oct 2024', es:'Oct 2024' }, { en:'just now', es:'ahora' }, 'CDMX'),
    T('espiga',     'Panadería La Espiga',      'Elena Ruiz',     'ER', '#5A6373', 'pro',     'canceled', 0,  1, 'disconnected',    0,   0,  { en:'Dec 2024', es:'Dic 2024' }, { en:'18 days ago', es:'hace 18 días' }, 'Puebla'),
  ];

  // representative invoices
  const INV = [
    { id:'F-4821', tenant:'tecnocel',   amount:1999, status:'paid',    date:{ en:'Jun 6', es:'6 Jun' }, method:'•••• 4242' },
    { id:'F-4820', tenant:'refadelnorte',amount:1999, status:'paid',   date:{ en:'Jun 5', es:'5 Jun' }, method:'•••• 8801' },
    { id:'F-4819', tenant:'hirata',     amount:999,  status:'paid',    date:{ en:'Jun 5', es:'5 Jun' }, method:'•••• 1190' },
    { id:'F-4818', tenant:'vetpatitas', amount:999,  status:'failed',  date:{ en:'Jun 4', es:'4 Jun' }, method:'•••• 6710' },
    { id:'F-4817', tenant:'lunaria',    amount:999,  status:'paid',    date:{ en:'Jun 4', es:'4 Jun' }, method:'•••• 3052' },
    { id:'F-4816', tenant:'ironfit',    amount:999,  status:'paid',    date:{ en:'Jun 3', es:'3 Jun' }, method:'•••• 7745' },
    { id:'F-4815', tenant:'tacoguero',  amount:499,  status:'pending', date:{ en:'Jun 3', es:'3 Jun' }, method:'OXXO' },
    { id:'F-4814', tenant:'cafearoma',  amount:499,  status:'paid',    date:{ en:'Jun 2', es:'2 Jun' }, method:'•••• 2390' },
    { id:'F-4813', tenant:'dalia',      amount:499,  status:'paid',    date:{ en:'Jun 1', es:'1 Jun' }, method:'•••• 6610' },
  ];

  const AUDIT = [
    { ic:'plus',   tone:'green',  type:'ev_signup',       tenant:'pinata',     time:{ en:'2 days ago', es:'hace 2 días' } },
    { ic:'arrowr', tone:'blue',   type:'ev_upgrade',      tenant:'lunaria',    detail:'Inicio → Pro', time:{ en:'2 days ago', es:'hace 2 días' } },
    { ic:'alert',  tone:'red',    type:'ev_payment_fail', tenant:'vetpatitas', time:{ en:'Jun 4', es:'4 Jun' } },
    { ic:'wifioff',tone:'red',    type:'ev_wa_down',      tenant:'ironfit',    time:{ en:'Jun 4', es:'4 Jun' } },
    { ic:'plus',   tone:'green',  type:'ev_signup',       tenant:'esteticabella', time:{ en:'5 days ago', es:'hace 5 días' } },
    { ic:'check',  tone:'green',  type:'ev_payment_ok',   tenant:'tecnocel',   time:{ en:'Jun 6', es:'6 Jun' } },
    { ic:'shield', tone:'amber',  type:'ev_suspend',      tenant:'espiga',     time:{ en:'18 days ago', es:'hace 18 días' } },
    { ic:'clock',  tone:'blue',   type:'ev_trial_start',  tenant:'esteticabella', time:{ en:'5 days ago', es:'hace 5 días' } },
    { ic:'arrowr', tone:'blue',   type:'ev_upgrade',      tenant:'refadelnorte', detail:'Pro → Negocio', time:{ en:'Apr 2025', es:'Abr 2025' } },
  ];

  // headline metrics from the full base (plans.js subscribers)
  const subs = (id) => window.planById(id).subscribers;
  const price = (id) => window.planById(id).priceMonthly;
  const mrr = window.PLANS.reduce((s, p) => s + p.subscribers * p.priceMonthly, 0);
  const activeBiz = window.PLANS.reduce((s, p) => s + p.subscribers, 0);

  const METRICS = {
    mrr,
    arr: mrr * 12,
    activeBiz,
    trials: 41,
    churn: 1.8,
    newThisMonth: 38,
    arpa: Math.round(mrr / activeBiz),
    mrrTrend: [382000, 401500, 423800, 449200, 471600, 498300, 531900, mrr],
    mrrTrendLabels: ['Nov','Dic','Ene','Feb','Mar','Abr','May','Jun'],
    deltas: { mrr: 5.3, activeBiz: 4.1, churn: -0.4, newThisMonth: 12 },
    planMix: window.PLANS.map(p => ({ id:p.id, name:p.name, color:p.color, count:p.subscribers })),
    collectedMTD: 418200,
    outstanding: 12480,
    failedPayments: 3,
  };

  window.PLAT = {
    money, moneyMXN, TENANTS, INV, AUDIT, METRICS,
    tenantById: (id) => TENANTS.find(t => t.id === id),
    SUB_STATUS: {
      active:   { key:'sub_active',   color:'green' },
      trial:    { key:'sub_trial',    color:'blue'  },
      past_due: { key:'sub_pastdue',  color:'amber' },
      canceled: { key:'sub_canceled', color:'slate' },
      paused:   { key:'sub_paused',   color:'slate' },
    },
    WA_STATUS: {
      connected:    { key:'wa_connected', color:'green', ic:'wifi' },
      needs_qr:     { key:'wa_needsqr',   color:'amber', ic:'qr' },
      disconnected: { key:'wa_down',      color:'red',   ic:'wifioff' },
    },
    INV_STATUS: {
      paid:    { key:'inv_paid',    color:'green' },
      pending: { key:'inv_pending', color:'amber' },
      failed:  { key:'inv_failed',  color:'red'   },
    },
  };
})();
