/* ============================================================
   HIRATICKET — i18n extension (Platform console + Landing)
   Merges into window.HT_T so window.tr() picks these up.
   Load AFTER i18n.js.
   ============================================================ */
(function () {
  Object.assign(window.HT_T, {
    /* ---- Platform nav ---- */
    p_dashboard:   { en: 'Overview',      es: 'Resumen' },
    p_tenants:     { en: 'Businesses',    es: 'Negocios' },
    p_billing:     { en: 'Billing',       es: 'Facturación' },
    p_plans:       { en: 'Plans',         es: 'Planes' },
    p_usage:       { en: 'Usage',         es: 'Uso' },
    p_connections: { en: 'WhatsApp',      es: 'WhatsApp' },
    p_audit:       { en: 'Audit log',     es: 'Auditoría' },
    p_settings:    { en: 'Settings',      es: 'Ajustes' },
    p_console:     { en: 'Platform console', es: 'Consola de plataforma' },
    p_search:      { en: 'Search businesses, owners…', es: 'Buscar negocios, dueños…' },
    back_to_app:   { en: 'Open app',      es: 'Abrir app' },

    /* ---- Dashboard ---- */
    p_overview_title: { en: 'Platform overview', es: 'Resumen de plataforma' },
    kpi_mrr:        { en: 'MRR',            es: 'MRR' },
    kpi_arr:        { en: 'ARR',            es: 'ARR' },
    kpi_active:     { en: 'Active businesses', es: 'Negocios activos' },
    kpi_trials:     { en: 'On trial',       es: 'En prueba' },
    kpi_churn:      { en: 'Churn (30d)',    es: 'Cancelación (30d)' },
    kpi_new:        { en: 'New this month', es: 'Nuevos este mes' },
    kpi_arpa:       { en: 'ARPA',           es: 'ARPA' },
    mrr_trend:      { en: 'MRR — last 8 months', es: 'MRR — últimos 8 meses' },
    plan_mix:       { en: 'Plan distribution', es: 'Distribución por plan' },
    recent_signups: { en: 'Recent signups', es: 'Altas recientes' },
    needs_attention:{ en: 'Needs attention', es: 'Requiere atención' },
    vs_last:        { en: 'vs last month',  es: 'vs mes anterior' },
    view_all:       { en: 'View all',       es: 'Ver todos' },

    /* ---- Tenants ---- */
    p_tenants_title:{ en: 'Businesses',     es: 'Negocios' },
    col_business:   { en: 'Business',       es: 'Negocio' },
    col_owner:      { en: 'Owner',          es: 'Dueño' },
    col_plan:       { en: 'Plan',           es: 'Plan' },
    col_mrr:        { en: 'MRR',            es: 'MRR' },
    col_seats:      { en: 'Agents',         es: 'Agentes' },
    col_wa:         { en: 'WhatsApp',       es: 'WhatsApp' },
    col_active:     { en: 'Last active',    es: 'Última actividad' },
    col_signed:     { en: 'Joined',         es: 'Alta' },
    all_plans:      { en: 'All plans',      es: 'Todos los planes' },
    all_status:     { en: 'All statuses',   es: 'Todos los estados' },

    /* subscription statuses */
    sub_active:     { en: 'Active',         es: 'Activo' },
    sub_trial:      { en: 'Trial',          es: 'Prueba' },
    sub_pastdue:    { en: 'Past due',       es: 'Vencido' },
    sub_canceled:   { en: 'Canceled',       es: 'Cancelado' },
    sub_paused:     { en: 'Paused',         es: 'Pausado' },

    /* wa statuses */
    wa_connected:   { en: 'Connected',      es: 'Conectado' },
    wa_needsqr:     { en: 'Needs QR',       es: 'Requiere QR' },
    wa_down:        { en: 'Disconnected',   es: 'Desconectado' },

    /* tenant detail */
    td_overview:    { en: 'Overview',       es: 'Resumen' },
    td_subscription:{ en: 'Subscription',   es: 'Suscripción' },
    td_usage:       { en: 'Usage (30 days)',es: 'Uso (30 días)' },
    td_connections: { en: 'WhatsApp numbers', es: 'Números de WhatsApp' },
    td_owner:       { en: 'Account owner',  es: 'Dueño de la cuenta' },
    td_change_plan: { en: 'Change plan',    es: 'Cambiar plan' },
    td_suspend:     { en: 'Suspend',        es: 'Suspender' },
    td_activate:    { en: 'Reactivate',     es: 'Reactivar' },
    td_open_app:    { en: 'Open as business', es: 'Abrir como negocio' },
    td_next_invoice:{ en: 'Next invoice',   es: 'Próxima factura' },
    td_method:      { en: 'Payment method', es: 'Método de pago' },
    td_since:       { en: 'Customer since', es: 'Cliente desde' },
    td_seats_used:  { en: 'Agents',         es: 'Agentes' },
    td_messages:    { en: 'Messages',       es: 'Mensajes' },
    td_orders:      { en: 'Orders',         es: 'Pedidos' },

    /* ---- Billing ---- */
    p_billing_title:{ en: 'Billing & subscriptions', es: 'Facturación y suscripciones' },
    tab_subs:       { en: 'Subscriptions',  es: 'Suscripciones' },
    tab_invoices:   { en: 'Invoices',       es: 'Facturas' },
    col_amount:     { en: 'Amount',         es: 'Monto' },
    col_invoice:    { en: 'Invoice',        es: 'Factura' },
    col_date:       { en: 'Date',           es: 'Fecha' },
    col_method:     { en: 'Method',         es: 'Método' },
    inv_paid:       { en: 'Paid',           es: 'Pagada' },
    inv_pending:    { en: 'Pending',        es: 'Pendiente' },
    inv_failed:     { en: 'Failed',         es: 'Fallida' },
    retry_charge:   { en: 'Retry charge',   es: 'Reintentar cobro' },
    collected:      { en: 'Collected (MTD)',es: 'Cobrado (mes)' },
    outstanding:    { en: 'Outstanding',    es: 'Por cobrar' },
    failed_pay:     { en: 'Failed payments',es: 'Pagos fallidos' },

    /* ---- Plans ---- */
    p_plans_title:  { en: 'Plans & feature flags', es: 'Planes y características' },
    create_plan:    { en: 'Create plan',    es: 'Crear plan' },
    per_mo:         { en: '/mo',            es: '/mes' },
    per_mo_long:    { en: 'per month',      es: 'por mes' },
    limit_agents:   { en: 'agents',         es: 'agentes' },
    limit_numbers:  { en: 'WhatsApp numbers', es: 'números de WhatsApp' },
    limit_msgs:     { en: 'msgs / month',   es: 'msjs / mes' },
    feature_flags:  { en: 'Features',       es: 'Características' },
    subscribers:    { en: 'subscribers',    es: 'suscriptores' },
    edit_plan:      { en: 'Edit',           es: 'Editar' },
    unlimited:      { en: 'Unlimited',      es: 'Ilimitado' },

    /* ---- Usage ---- */
    p_usage_title:  { en: 'Usage by business', es: 'Uso por negocio' },
    u_messages:     { en: 'Messages',       es: 'Mensajes' },
    u_orders:       { en: 'Orders',         es: 'Pedidos' },
    u_agents:       { en: 'Agents',         es: 'Agentes' },
    of_limit:       { en: 'of limit',       es: 'del límite' },
    near_limit:     { en: 'Near limit',     es: 'Cerca del límite' },

    /* ---- Connections ---- */
    p_conn_title:   { en: 'WhatsApp connection health', es: 'Salud de conexiones WhatsApp' },
    uptime:         { en: 'Uptime (30d)',   es: 'Disponibilidad (30d)' },
    last_seen:      { en: 'Last seen',      es: 'Visto por última vez' },
    numbers:        { en: 'Numbers',        es: 'Números' },
    all_connected:  { en: 'All connected',  es: 'Todas conectadas' },

    /* ---- Audit ---- */
    p_audit_title:  { en: 'Audit log',      es: 'Bitácora de auditoría' },
    ev_signup:      { en: 'New business signed up', es: 'Nuevo negocio registrado' },
    ev_upgrade:     { en: 'Plan upgraded',  es: 'Plan mejorado' },
    ev_downgrade:   { en: 'Plan downgraded',es: 'Plan reducido' },
    ev_payment_ok:  { en: 'Payment received', es: 'Pago recibido' },
    ev_payment_fail:{ en: 'Payment failed', es: 'Pago fallido' },
    ev_wa_down:     { en: 'WhatsApp disconnected', es: 'WhatsApp desconectado' },
    ev_suspend:     { en: 'Business suspended', es: 'Negocio suspendido' },
    ev_trial_start: { en: 'Trial started',  es: 'Prueba iniciada' },

    /* generic platform */
    p_status:       { en: 'Status',         es: 'Estado' },
    p_actions:      { en: 'Actions',        es: 'Acciones' },
    this_month:     { en: 'This month',     es: 'Este mes' },
    super_admin:    { en: 'Super admin',    es: 'Super admin' },
  });
})();
