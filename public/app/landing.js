/* ============================================================
   HIRATICKET — Landing logic (i18n, pricing, FAQ, toggles)
   ============================================================ */
(function () {
  var L = (o, lang) => (o && (o[lang] || o.es || o.en)) || '';

  var DICT = {
    es: {
      ann1: '🎉 14 días gratis · sin tarjeta de crédito', ann2: 'Conecta tu WhatsApp en 2 minutos',
      nav_product: 'Producto', nav_pricing: 'Precios', nav_platform: 'Plataforma', nav_login: 'Iniciar sesión', nav_trial: 'Prueba gratis',
      hero_badge: 'WhatsApp + Pedidos',
      hero_title: 'TODO TU NEGOCIO POR <span class="y">WHATSAPP</span>',
      hero_sub: 'Atiende cada chat de WhatsApp, rutea pedidos entre áreas y guarda todo el historial del cliente. La bandeja y el back-office de tu negocio, juntos.',
      hero_cta1: 'Empieza gratis', hero_cta2: 'Ver demo en vivo',
      trust1: 'Sin tarjeta', trust2: 'Conexión en 2 min', trust3: 'Cancela cuando quieras',
      logos_title: 'Negocios de todo México ya venden por WhatsApp con Hiraticket',
      feat_eyebrow: 'Todo en un lugar', feat_title: 'Deja de saltar entre apps',
      feat_sub: 'Chats, pedidos y equipo en una sola pantalla pensada para negocios que venden por WhatsApp.',
      f1t: 'Bandeja unificada', f1d: 'Todos los chats de WhatsApp de tu negocio en una bandeja, con filtros, asignación y estados.',
      f2t: 'Pedidos vinculados', f2d: 'Crea pedidos desde el chat y mira el cliente, sus compras y su historial lado a lado.',
      f3t: 'Tablero Kanban', f3d: 'Arrastra pedidos por etapas o por áreas: Ventas, Diseño, Producción y Envíos.',
      f4t: 'Áreas y ruteo', f4d: 'Transfiere chats y pedidos entre agentes y áreas con bitácora completa de cada cambio.',
      f5t: 'Plantillas rápidas', f5d: 'Respuestas listas con variables como {{name}} y {{order_number}} que se llenan solas.',
      f6t: 'En tiempo real', f6d: 'Mensajes, transferencias y estados se actualizan al instante para todo el equipo.',
      split_eyebrow: 'Cliente 360', split_title: 'Todo el contexto del cliente, sin buscar',
      split_sub: 'Abre una conversación y ve sus pedidos, notas internas e historial completo. Atiende mejor, sin pedir el número de pedido tres veces.',
      s1t: 'Pedidos e historial', s1d: 'Cada compra, estado y monto del cliente en una vista expandible.',
      s2t: 'Notas internas', s2d: 'Comparte contexto con tu equipo sin que lo vea el cliente.',
      s3t: 'Bitácora de cambios', s3d: 'Quién transfirió, quién cambió el estado y cuándo. Todo queda registrado.',
      price_eyebrow: 'Precios', price_title: 'Planes simples, en pesos', price_sub: 'Empieza con 14 días gratis. Cambia o cancela tu plan cuando quieras.',
      bill_monthly: 'Mensual', bill_annual: 'Anual', bill_save: '2 meses gratis',
      quote_eyebrow: 'Historias reales',
      quote_text: '“Antes perdíamos pedidos en mensajes sin contestar. Con Hiraticket todo el equipo ve el mismo chat y nada se cae.”',
      quote_by: 'Hirata · Impresión Digital',
      faq_title: 'Preguntas frecuentes',
      cta_title: 'Empieza hoy', cta_sub: 'Conecta tu WhatsApp y organiza tus pedidos en minutos. 14 días gratis.', cta_btn: 'Crear cuenta gratis',
      foot_tag: 'La bandeja de WhatsApp y los pedidos de tu negocio, en un solo lugar.',
      foot_product: 'Producto', foot_company: 'Empresa', foot_legal: 'Legal', foot_demo: 'Demo',
      foot_privacy: 'Privacidad', foot_terms: 'Términos', foot_made: 'Hecho en México 🇲🇽',
      foot_note: 'Integración no oficial vía WhatsApp Web.',
      most_popular: 'Más popular', per_mo: '/mes', billed_annual: 'facturado anual', start_trial: 'Empezar gratis',
      up_to: 'Hasta', agents: 'agentes', numbers: 'números', unlimited_agents: 'Agentes ilimitados',
    },
    en: {
      ann1: '🎉 14-day free trial · no credit card', ann2: 'Connect your WhatsApp in 2 minutes',
      nav_product: 'Product', nav_pricing: 'Pricing', nav_platform: 'Platform', nav_login: 'Sign in', nav_trial: 'Start free',
      hero_badge: 'WhatsApp + Orders',
      hero_title: 'RUN YOUR SHOP ON <span class="y">WHATSAPP</span>',
      hero_sub: 'Handle every WhatsApp chat, route orders across areas, and keep every customer\'s history. Your inbox and back-office, together.',
      hero_cta1: 'Start for free', hero_cta2: 'See live demo',
      trust1: 'No credit card', trust2: '2-min setup', trust3: 'Cancel anytime',
      logos_title: 'Businesses across Mexico already sell on WhatsApp with Hiraticket',
      feat_eyebrow: 'All in one place', feat_title: 'Stop jumping between apps',
      feat_sub: 'Chats, orders and team on a single screen built for businesses selling on WhatsApp.',
      f1t: 'Unified inbox', f1d: 'Every WhatsApp chat in one inbox, with filters, assignment and statuses.',
      f2t: 'Linked orders', f2d: 'Create orders from the chat and see the customer, their purchases and history side by side.',
      f3t: 'Kanban board', f3d: 'Drag orders across stages or areas: Sales, Design, Production and Shipping.',
      f4t: 'Areas & routing', f4d: 'Transfer chats and orders between agents and areas with a full audit trail.',
      f5t: 'Quick templates', f5d: 'Ready replies with variables like {{name}} and {{order_number}} that auto-fill.',
      f6t: 'Real-time', f6d: 'Messages, transfers and statuses update instantly for the whole team.',
      split_eyebrow: 'Customer 360', split_title: 'Full customer context, no searching',
      split_sub: 'Open a conversation and see their orders, internal notes and full history. Serve better, without asking for the order number three times.',
      s1t: 'Orders & history', s1d: 'Every purchase, status and amount in an expandable view.',
      s2t: 'Internal notes', s2d: 'Share context with your team without the customer seeing it.',
      s3t: 'Change log', s3d: 'Who transferred, who changed the status and when. It is all recorded.',
      price_eyebrow: 'Pricing', price_title: 'Simple plans, in pesos', price_sub: 'Start with a 14-day free trial. Change or cancel anytime.',
      bill_monthly: 'Monthly', bill_annual: 'Annual', bill_save: '2 months free',
      quote_eyebrow: 'Real stories',
      quote_text: '“We used to lose orders in unanswered messages. With Hiraticket the whole team sees the same chat and nothing slips.”',
      quote_by: 'Hirata · Digital Printing',
      faq_title: 'Frequently asked questions',
      cta_title: 'Start today', cta_sub: 'Connect your WhatsApp and organize your orders in minutes. 14 days free.', cta_btn: 'Create a free account',
      foot_tag: 'Your business\'s WhatsApp inbox and orders, in one place.',
      foot_product: 'Product', foot_company: 'Company', foot_legal: 'Legal', foot_demo: 'Demo',
      foot_privacy: 'Privacy', foot_terms: 'Terms', foot_made: 'Made in Mexico 🇲🇽',
      foot_note: 'Unofficial integration via WhatsApp Web.',
      most_popular: 'Most popular', per_mo: '/mo', billed_annual: 'billed annually', start_trial: 'Start free',
      up_to: 'Up to', agents: 'agents', numbers: 'numbers', unlimited_agents: 'Unlimited agents',
    },
  };

  var FAQ = [
    { q:{ es:'¿WhatsApp es oficial?', en:'Is the WhatsApp connection official?' }, a:{ es:'Usamos una conexión tipo WhatsApp Web: vinculas tu propio número escaneando un QR. Es no oficial, por eso mostramos siempre el estado de conexión y te avisamos si se cae.', en:'We use a WhatsApp Web-style connection: you link your own number by scanning a QR. It is unofficial, so we always show the connection status and alert you if it drops.' } },
    { q:{ es:'¿Puedo conectar varios números?', en:'Can I connect multiple numbers?' }, a:{ es:'Sí. Desde el plan Pro puedes conectar 2 números y en Negocio hasta 5, cada uno con su propia bandeja.', en:'Yes. From the Pro plan you can connect 2 numbers and up to 5 on Business, each with its own inbox.' } },
    { q:{ es:'¿Hay prueba gratis?', en:'Is there a free trial?' }, a:{ es:'Todos los planes incluyen 14 días gratis, sin tarjeta. Al terminar eliges el plan que mejor te quede.', en:'Every plan includes a 14-day free trial, no card required. When it ends you pick the plan that fits best.' } },
    { q:{ es:'¿Puedo cambiar o cancelar mi plan?', en:'Can I change or cancel my plan?' }, a:{ es:'Cuando quieras, desde Ajustes. Los cambios se aplican en tu siguiente factura sin penalización.', en:'Anytime, from Settings. Changes apply on your next invoice with no penalty.' } },
    { q:{ es:'¿Cómo funciona la facturación anual?', en:'How does annual billing work?' }, a:{ es:'Pagas 10 meses y obtienes 12: dos meses gratis al elegir facturación anual.', en:'You pay for 10 months and get 12: two months free when you choose annual billing.' } },
    { q:{ es:'¿Mis datos están seguros?', en:'Is my data safe?' }, a:{ es:'Tus conversaciones y pedidos viven en tu cuenta con roles y permisos. Cada cambio queda en la bitácora de auditoría.', en:'Your conversations and orders live in your account with roles and permissions. Every change is kept in the audit log.' } },
  ];

  var lang = (function(){ try { return JSON.parse(localStorage.getItem('ht_lang')||'"es"'); } catch(e){ return 'es'; } })();
  var theme = (function(){ try { return JSON.parse(localStorage.getItem('ht_theme')||'"light"'); } catch(e){ return 'light'; } })();
  var annual = false;

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    document.getElementById('themeBtn').innerHTML = theme==='dark'
      ? '<svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      : '<svg width="19" height="19" viewBox="0 0 24 24"><path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  function money(n){ return '$' + Math.round(n).toLocaleString('es-MX'); }

  function renderPricing() {
    var d = DICT[lang];
    var grid = document.getElementById('priceGrid');
    grid.innerHTML = window.PLANS.map(function(p){
      var monthly = p.priceMonthly;
      var eff = annual ? Math.round(p.priceMonthly*10/12) : monthly;
      var billed = annual ? ('<div class="price-billed">'+d.billed_annual+' · '+money(p.priceMonthly*10)+' MXN/'+(lang==='es'?'año':'yr')+'</div>') : '<div class="price-billed">&nbsp;</div>';
      var lim = (p.limits.agents<0 ? d.unlimited_agents : (d.up_to+' '+p.limits.agents+' '+d.agents)) + ' · ' + p.limits.numbers + ' ' + d.numbers;
      var feats = p.features.map(function(f){ return '<div class="price-feat"><span class="ck"><svg width="13" height="13"><use href="#i-check"/></svg></span>'+L(f,lang)+'</div>'; }).join('');
      return '<div class="price-card'+(p.popular?' pop':'')+'">'
        + (p.popular?'<span class="pill pill-brand" style="position:absolute;top:-11px;left:50%;transform:translateX(-50%)">★ '+d.most_popular+'</span>':'')
        + '<div class="pname">'+L(p.name,lang)+'</div>'
        + '<div class="ptag">'+L(p.tagline,lang)+'</div>'
        + '<div class="price-amt"><span class="amt">'+money(eff)+'</span><span class="per">MXN '+d.per_mo+'</span></div>'
        + billed
        + '<div class="muted" style="font-size:12.5px;font-weight:600">'+lim+'</div>'
        + '<a class="btn '+(p.popular?'btn-primary':'btn-outline')+' btn-lg btn-block" href="Login.html">'+d.start_trial+'</a>'
        + '<div class="price-feats">'+feats+'</div>'
        + '</div>';
    }).join('');
  }

  function renderFaq() {
    var list = document.getElementById('faqList');
    list.innerHTML = FAQ.map(function(f,i){
      return '<div class="faq-item" data-fi="'+i+'"><button class="faq-q">'+L(f.q,lang)+'<span class="chev"><svg width="18" height="18"><use href="#i-chev"/></svg></span></button><div class="faq-a"><div class="faq-a-inner">'+L(f.a,lang)+'</div></div></div>';
    }).join('');
    list.querySelectorAll('.faq-q').forEach(function(btn){
      btn.addEventListener('click', function(){ btn.parentNode.classList.toggle('open'); });
    });
  }

  function applyLang() {
    var d = DICT[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k = el.getAttribute('data-i18n'); if (d[k] != null) el.textContent = d[k];
    });
    document.getElementById('heroTitle').innerHTML = d.hero_title;
    document.querySelectorAll('[data-lang]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-lang')===lang); });
    renderPricing(); renderFaq();
  }

  // wire toggles
  document.querySelectorAll('[data-lang]').forEach(function(b){
    b.addEventListener('click', function(){ lang = b.getAttribute('data-lang'); try{ localStorage.setItem('ht_lang', JSON.stringify(lang)); }catch(e){} applyLang(); });
  });
  document.getElementById('themeBtn').addEventListener('click', function(){ theme = theme==='dark'?'light':'dark'; try{ localStorage.setItem('ht_theme', JSON.stringify(theme)); }catch(e){} applyTheme(); });
  document.getElementById('billToggle').addEventListener('click', function(){
    annual = !annual; this.classList.toggle('on', annual);
    document.getElementById('lblMonthly').style.color = annual ? 'var(--text-muted)' : 'var(--text)';
    document.getElementById('lblAnnual').style.color = annual ? 'var(--text)' : 'var(--text-muted)';
    renderPricing();
  });

  applyTheme();
  applyLang();
})();
