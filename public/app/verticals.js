/* ============================================================
   HIRATICKET — Verticals, catalog, appointments + config helpers
   Presets relabel the SAME stage/area ids per industry, so all
   existing data keeps working while the UI reads industry wording.
   ============================================================ */
(function () {
  const SC = { new:'slate', design:'blue', production:'violet', ready:'teal', delivered:'green' };
  const AC = { ventas:'brand', diseno:'blue', produccion:'violet', envios:'teal' };
  const S = (n, d, p, r, dl) => [ {id:'new',name:n,color:SC.new},{id:'design',name:d,color:SC.design},{id:'production',name:p,color:SC.production},{id:'ready',name:r,color:SC.ready},{id:'delivered',name:dl,color:SC.delivered} ];
  const A = (v, di, pr, en) => [ {id:'ventas',name:v,color:AC.ventas},{id:'diseno',name:di,color:AC.diseno},{id:'produccion',name:pr,color:AC.produccion},{id:'envios',name:en,color:AC.envios} ];

  const VERTICALS = [
    { id:'imprenta', icon:'sparkles', name:{ en:'Print shop', es:'Imprenta' },
      object:{ en:'Orders', es:'Pedidos' },
      stages: S({en:'New',es:'Nuevo'},{en:'In design',es:'En diseño'},{en:'In production',es:'En producción'},{en:'Ready',es:'Listo'},{en:'Delivered',es:'Entregado'}),
      areas: A({en:'Sales',es:'Ventas'},{en:'Design',es:'Diseño'},{en:'Production',es:'Producción'},{en:'Shipping',es:'Envíos'}),
      fields:[{en:'Paper type',es:'Tipo de papel'},{en:'Finish',es:'Acabado'}] },
    { id:'restaurante', icon:'store', name:{ en:'Restaurant', es:'Restaurante' },
      object:{ en:'Orders', es:'Órdenes' },
      stages: S({en:'Received',es:'Recibida'},{en:'Confirmed',es:'Confirmada'},{en:'In kitchen',es:'En cocina'},{en:'Ready',es:'Lista'},{en:'Delivered',es:'Entregada'}),
      areas: A({en:'Counter',es:'Mostrador'},{en:'Kitchen',es:'Cocina'},{en:'Bar',es:'Barra'},{en:'Delivery',es:'Reparto'}),
      fields:[{en:'Table / Address',es:'Mesa / Domicilio'},{en:'Allergies',es:'Alergias'}] },
    { id:'salon', icon:'sparkles', name:{ en:'Salon / Spa', es:'Estética / Salón' },
      object:{ en:'Appointments', es:'Citas' },
      stages: S({en:'Requested',es:'Solicitada'},{en:'Confirmed',es:'Confirmada'},{en:'In service',es:'En servicio'},{en:'Finished',es:'Terminada'},{en:'Paid',es:'Pagada'}),
      areas: A({en:'Front desk',es:'Recepción'},{en:'Styling',es:'Estilismo'},{en:'Spa',es:'Spa'},{en:'Checkout',es:'Caja'}),
      fields:[{en:'Service',es:'Servicio'},{en:'Stylist',es:'Estilista'}] },
    { id:'veterinaria', icon:'shield', name:{ en:'Vet clinic', es:'Veterinaria' },
      object:{ en:'Cases', es:'Casos' },
      stages: S({en:'New',es:'Nuevo'},{en:'Scheduled',es:'Agendado'},{en:'In consult',es:'En consulta'},{en:'Treatment',es:'Tratamiento'},{en:'Discharged',es:'Alta'}),
      areas: A({en:'Reception',es:'Recepción'},{en:'Consult',es:'Consulta'},{en:'Lab',es:'Laboratorio'},{en:'Pharmacy',es:'Farmacia'}),
      fields:[{en:'Pet',es:'Mascota'},{en:'Species',es:'Especie'}] },
    { id:'retail', icon:'store', name:{ en:'Retail store', es:'Tienda / Retail' },
      object:{ en:'Orders', es:'Pedidos' },
      stages: S({en:'New',es:'Nuevo'},{en:'Reserved',es:'Apartado'},{en:'Picking',es:'Preparando'},{en:'Ready',es:'Listo'},{en:'Delivered',es:'Entregado'}),
      areas: A({en:'Sales',es:'Ventas'},{en:'Warehouse',es:'Almacén'},{en:'Packing',es:'Empaque'},{en:'Shipping',es:'Envíos'}),
      fields:[{en:'SKU',es:'SKU'},{en:'Size/Color',es:'Talla/Color'}] },
    { id:'taller', icon:'sliders', name:{ en:'Repair / Auto', es:'Taller / Refaccionaria' },
      object:{ en:'Work orders', es:'Órdenes' },
      stages: S({en:'Received',es:'Recibida'},{en:'Diagnosis',es:'Diagnóstico'},{en:'In repair',es:'En reparación'},{en:'Ready',es:'Lista'},{en:'Delivered',es:'Entregada'}),
      areas: A({en:'Front desk',es:'Recepción'},{en:'Diagnosis',es:'Diagnóstico'},{en:'Workshop',es:'Taller'},{en:'Delivery',es:'Entrega'}),
      fields:[{en:'Plate',es:'Placa'},{en:'Model',es:'Modelo'}] },
  ];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const defaultConfig = () => {
    const v = VERTICALS[0];
    return { verticalId:v.id, object:{...v.object}, stages:clone(v.stages), areas:clone(v.areas), fields:clone(v.fields) };
  };
  const configFromVertical = (id) => {
    const v = VERTICALS.find(x=>x.id===id) || VERTICALS[0];
    return { verticalId:v.id, object:{...v.object}, stages:clone(v.stages), areas:clone(v.areas), fields:clone(v.fields) };
  };

  // label/color resolvers (cfg arrays → fallback to base meta)
  const findStage = (id, cfg) => cfg && cfg.stages && cfg.stages.find(s=>s.id===id);
  const findArea = (id, cfg) => cfg && cfg.areas && cfg.areas.find(s=>s.id===id);
  const stageName = (id, lang, cfg) => { const s=findStage(id,cfg); if(s) return window.L(s.name,lang); const m=window.HT.orderStatusById(id); return m?window.tr(m.key,lang):id; };
  const areaName = (id, lang, cfg) => { const s=findArea(id,cfg); if(s) return window.L(s.name,lang); const m=window.HT.areaById(id); return m?window.L(m.name,lang):id; };
  const stageColor = (id, cfg) => { const s=findStage(id,cfg); if(s) return s.color; const m=window.HT.orderStatusById(id); return m?m.color:'slate'; };
  const areaColor = (id, cfg) => { const s=findArea(id,cfg); if(s) return s.color; const m=window.HT.areaById(id); return m?m.color:'slate'; };
  const objectName = (lang, cfg) => (cfg && cfg.object) ? window.L(cfg.object, lang) : window.tr('nav_orders', lang);

  /* ---- Catalog ---- */
  const cat = (id, name, sku, category, price, unit) => ({ id, name, sku, category, price, unit });
  const CATALOG = [
    cat('p1', {en:'Die-cut stickers 5×5cm', es:'Stickers troquelados 5×5cm'}, 'STK-DC-5', {en:'Stickers',es:'Stickers'}, 2.9, {en:'pc',es:'pza'}),
    cat('p2', {en:'Holographic stickers',   es:'Stickers holográficos'},      'STK-HOLO', {en:'Stickers',es:'Stickers'}, 3.6, {en:'pc',es:'pza'}),
    cat('p3', {en:'Business cards 350g',     es:'Tarjetas de presentación 350g'},'CARD-350',{en:'Print',es:'Impresión'}, 0.65, {en:'pc',es:'pza'}),
    cat('p4', {en:'Half-letter flyers',      es:'Volantes media carta'},        'FLY-HC',  {en:'Print',es:'Impresión'}, 0.9, {en:'pc',es:'pza'}),
    cat('p5', {en:'Printed banner 2×1m',     es:'Lona impresa 2×1m'},           'BAN-2x1', {en:'Large format',es:'Gran formato'}, 540, {en:'pc',es:'pza'}),
    cat('p6', {en:'Menu vinyl (m²)',         es:'Vinil de menú (m²)'},          'VIN-M2',  {en:'Large format',es:'Gran formato'}, 280, {en:'m²',es:'m²'}),
    cat('p7', {en:'DTF t-shirt, full color', es:'Playera DTF, full color'},     'DTF-SHIRT',{en:'Apparel',es:'Textil'}, 95, {en:'pc',es:'pza'}),
    cat('p8', {en:'A4 kiss-cut sheet',       es:'Hoja A4 kiss-cut'},            'STK-A4',  {en:'Stickers',es:'Stickers'}, 90, {en:'pc',es:'pza'}),
    cat('p9', {en:'Product labels (roll)',   es:'Etiquetas de producto (rollo)'},'LBL-ROLL',{en:'Labels',es:'Etiquetas'}, 0.85, {en:'pc',es:'pza'}),
    cat('p10',{en:'Setup & proof',           es:'Setup y prueba'},              'SETUP',   {en:'Service',es:'Servicio'}, 250, {en:'svc',es:'serv'}),
  ];

  /* ---- Appointments ---- */
  const APPTS = [
    { id:'ap1', contactId:'c1', title:{en:'Pickup — holographic stickers',es:'Recoger — stickers holográficos'}, day:'today', time:'11:30', area:'envios', agent:'a_bru', status:'confirmed' },
    { id:'ap2', contactId:'c5', title:{en:'Design review',es:'Revisión de diseño'}, day:'today', time:'13:00', area:'diseno', agent:'a_die', status:'confirmed' },
    { id:'ap3', contactId:'c3', title:{en:'Quote call — business cards',es:'Llamada cotización — tarjetas'}, day:'today', time:'16:15', area:'ventas', agent:'a_sof', status:'pending' },
    { id:'ap4', contactId:'c6', title:{en:'Pickup — member decals',es:'Recoger — calcomanías socios'}, day:'tomorrow', time:'10:00', area:'envios', agent:'a_bru', status:'confirmed' },
    { id:'ap5', contactId:'c2', title:{en:'Reorder — product labels',es:'Resurtido — etiquetas'}, day:'tomorrow', time:'12:30', area:'ventas', agent:'a_mar', status:'pending' },
    { id:'ap6', contactId:'c4', title:{en:'Install — menu vinyl',es:'Instalación — vinil de menú'}, day:'tomorrow', time:'15:00', area:'produccion', agent:'a_pao', status:'confirmed' },
  ];

  /* ---- Campaigns ---- */
  const CAMPAIGNS = [
    { id:'cmp1', name:{en:'Back to school 2026',es:'Regreso a clases 2026'}, segment:'Mayoreo', recipients:184, status:'sent', delivered:97, read:71, date:{en:'Jun 1',es:'1 Jun'} },
    { id:'cmp2', name:{en:'Holographic launch',es:'Lanzamiento holográfico'}, segment:'all', recipients:560, status:'sent', delivered:94, read:63, date:{en:'May 24',es:'24 May'} },
    { id:'cmp3', name:{en:'Weekend 15% off',es:'Fin de semana 15% off'}, segment:'Recurrente', recipients:92, status:'scheduled', delivered:0, read:0, date:{en:'Jun 9',es:'9 Jun'} },
  ];

  window.HT.VERTICALS = VERTICALS;
  window.HT.CATALOG = CATALOG;
  window.HT.APPTS = APPTS;
  window.HT.CAMPAIGNS = CAMPAIGNS;
  window.HT.defaultConfig = defaultConfig;
  window.HT.configFromVertical = configFromVertical;
  window.HT.stageName = stageName;
  window.HT.areaName = areaName;
  window.HT.stageColor = stageColor;
  window.HT.areaColor = areaColor;
  window.HT.objectName = objectName;
})();
