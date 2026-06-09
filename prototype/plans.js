/* ============================================================
   HIRATICKET — Canonical pricing plans (shared by Platform + Landing)
   ============================================================ */
(function () {
  window.PLANS = [
    {
      id: 'inicio', name: { en: 'Starter', es: 'Inicio' }, color: 'slate',
      tagline: { en: 'For a single shop getting organized.', es: 'Para un negocio que se está organizando.' },
      priceMonthly: 499, popular: false, subscribers: 184,
      limits: { agents: 3, numbers: 1, msgs: 1000 },
      features: [
        { en: 'Unified WhatsApp inbox', es: 'Bandeja de WhatsApp unificada' },
        { en: 'Orders & Kanban board', es: 'Pedidos y tablero Kanban' },
        { en: 'Message templates', es: 'Plantillas de mensajes' },
        { en: 'Email support', es: 'Soporte por correo' },
      ],
    },
    {
      id: 'pro', name: { en: 'Pro', es: 'Pro' }, color: 'brand',
      tagline: { en: 'For growing teams that route work.', es: 'Para equipos que rutean el trabajo.' },
      priceMonthly: 999, popular: true, subscribers: 297,
      limits: { agents: 10, numbers: 2, msgs: 5000 },
      features: [
        { en: 'Everything in Starter', es: 'Todo lo de Inicio' },
        { en: 'Areas & smart routing', es: 'Áreas y ruteo inteligente' },
        { en: 'Roles & permissions', es: 'Roles y permisos' },
        { en: 'Metrics & reports', es: 'Métricas y reportes' },
        { en: 'Priority support', es: 'Soporte prioritario' },
      ],
    },
    {
      id: 'negocio', name: { en: 'Business', es: 'Negocio' }, color: 'violet',
      tagline: { en: 'For multi-branch operations at scale.', es: 'Para operaciones multi-sucursal a escala.' },
      priceMonthly: 1999, popular: false, subscribers: 86,
      limits: { agents: -1, numbers: 5, msgs: -1 },
      features: [
        { en: 'Everything in Pro', es: 'Todo lo de Pro' },
        { en: 'Unlimited agents', es: 'Agentes ilimitados' },
        { en: 'API & webhooks', es: 'API y webhooks' },
        { en: 'Audit log', es: 'Bitácora de auditoría' },
        { en: 'Dedicated onboarding & SLA', es: 'Onboarding dedicado y SLA' },
      ],
    },
  ];
  window.planById = (id) => window.PLANS.find(p => p.id === id);
  window.planPrice = (plan, annual) => annual ? plan.priceMonthly * 10 : plan.priceMonthly; // annual = 2 months free
})();
