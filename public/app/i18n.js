/* ============================================================
   HIRATICKET — i18n
   Flat UI dictionary + L() helper for bilingual data fields.
   ============================================================ */
(function () {
  const T = {
    // nav
    nav_chat:        { en: 'Chat',       es: 'Chat' },
    nav_orders:      { en: 'Orders',     es: 'Pedidos' },
    nav_kanban:      { en: 'Board',      es: 'Tablero' },
    nav_agents:      { en: 'Agents',     es: 'Agentes' },
    nav_canned:      { en: 'Templates',  es: 'Mensajes' },
    nav_settings:    { en: 'Settings',   es: 'Ajustes' },

    // topbar
    search_ph:       { en: 'Search conversations, orders, customers…', es: 'Buscar chats, pedidos, clientes…' },
    new_order:       { en: 'New order',  es: 'Nuevo pedido' },
    connected:       { en: 'Connected',  es: 'Conectado' },
    reconnecting:    { en: 'Reconnecting…', es: 'Reconectando…' },
    disconnected:    { en: 'Disconnected', es: 'Desconectado' },
    wa_number:       { en: 'Business line', es: 'Línea del negocio' },
    reconnect:       { en: 'Reconnect',  es: 'Reconectar' },
    scan_qr:         { en: 'Scan QR',    es: 'Escanear QR' },
    drop_banner:     { en: 'WhatsApp lost connection — incoming messages are paused until you reconnect.', es: 'WhatsApp perdió la conexión — los mensajes entrantes están en pausa hasta reconectar.' },

    // chat list
    tab_mine:        { en: 'Mine',       es: 'Míos' },
    tab_unassigned:  { en: 'Unassigned', es: 'Sin asignar' },
    tab_all:         { en: 'All',        es: 'Todos' },
    filter_status:   { en: 'Status',     es: 'Estado' },
    filter_area:     { en: 'Area',       es: 'Área' },
    filter_agent:    { en: 'Agent',      es: 'Agente' },
    unread_only:     { en: 'Unread only', es: 'Solo no leídos' },
    no_convos:       { en: 'No conversations', es: 'Sin conversaciones' },
    no_convos_sub:   { en: 'Nothing matches these filters yet.', es: 'Nada coincide con estos filtros aún.' },

    // statuses (conversation)
    st_open:         { en: 'Open',       es: 'Abierto' },
    st_pending:      { en: 'Pending',    es: 'Pendiente' },
    st_resolved:     { en: 'Resolved',   es: 'Resuelto' },

    // workspace
    ws_orders:       { en: 'Orders',     es: 'Pedidos' },
    ws_notes:        { en: 'Internal notes', es: 'Notas internas' },
    ws_actions:      { en: 'Actions',    es: 'Acciones' },
    ws_activity:     { en: 'Activity',   es: 'Actividad' },
    add_order:       { en: 'New order',  es: 'Nuevo pedido' },
    add_note_ph:     { en: 'Add an internal note… (only your team sees this)', es: 'Agrega una nota interna… (solo la ve tu equipo)' },
    post_note:       { en: 'Post note',  es: 'Publicar' },
    lifetime:        { en: 'Lifetime',   es: 'Total histórico' },
    first_seen:      { en: 'First seen', es: 'Primer contacto' },
    phone:           { en: 'Phone',      es: 'Teléfono' },
    no_orders_yet:   { en: 'No orders yet', es: 'Sin pedidos aún' },

    // actions
    act_transfer:    { en: 'Transfer',   es: 'Transferir' },
    act_status:      { en: 'Change status', es: 'Cambiar estado' },
    act_tag:         { en: 'Add tag',    es: 'Etiquetar' },
    act_order:       { en: 'Create order', es: 'Crear pedido' },
    act_resolve:     { en: 'Resolve',    es: 'Resolver' },
    act_followup:    { en: 'Follow-up',  es: 'Seguimiento' },
    act_accept:      { en: 'Accept',     es: 'Aceptar' },
    act_reopen:      { en: 'Reopen',     es: 'Reabrir' },

    // composer
    composer_ph:     { en: 'Type a message…', es: 'Escribe un mensaje…' },
    canned:          { en: 'Templates',  es: 'Plantillas' },
    send:            { en: 'Send',       es: 'Enviar' },

    // empty chat
    empty_chat:      { en: 'Select a conversation', es: 'Elige una conversación' },
    empty_chat_sub:  { en: 'Pick a chat from the list to see the customer, their orders, and the WhatsApp thread side by side.', es: 'Elige un chat de la lista para ver al cliente, sus pedidos y la conversación de WhatsApp lado a lado.' },

    // QR / not connected
    qr_title:        { en: 'Connect WhatsApp', es: 'Conecta WhatsApp' },
    qr_sub:          { en: 'Open WhatsApp on the business phone → Linked devices → Link a device, then scan this code.', es: 'Abre WhatsApp en el teléfono del negocio → Dispositivos vinculados → Vincular dispositivo, y escanea este código.' },
    qr_waiting:      { en: 'Waiting for scan…', es: 'Esperando escaneo…' },
    qr_refresh:      { en: 'Refresh code', es: 'Actualizar código' },

    // orders
    orders_title:    { en: 'Orders',     es: 'Pedidos' },
    col_order:       { en: 'Order',      es: 'Pedido' },
    col_customer:    { en: 'Customer',   es: 'Cliente' },
    col_status:      { en: 'Status',     es: 'Estado' },
    col_area:        { en: 'Area',       es: 'Área' },
    col_assignee:    { en: 'Assignee',   es: 'Asignado' },
    col_priority:    { en: 'Priority',   es: 'Prioridad' },
    col_items:       { en: 'Items',      es: 'Artículos' },
    col_total:       { en: 'Total',      es: 'Total' },
    col_created:     { en: 'Created',    es: 'Creado' },
    col_updated:     { en: 'Updated',    es: 'Actualizado' },
    col_tags:        { en: 'Tags',       es: 'Etiquetas' },
    export:          { en: 'Export',     es: 'Exportar' },
    columns:         { en: 'Columns',    es: 'Columnas' },
    saved_views:     { en: 'Saved views',es: 'Vistas' },
    sort:            { en: 'Sort',       es: 'Ordenar' },
    filters:         { en: 'Filters',    es: 'Filtros' },
    comfortable:     { en: 'Comfortable',es: 'Cómodo' },
    compact:         { en: 'Compact',    es: 'Compacto' },
    selected:        { en: 'selected',   es: 'seleccionados' },
    bulk_transfer:   { en: 'Transfer',   es: 'Transferir' },
    bulk_status:     { en: 'Set status', es: 'Estado' },
    bulk_tag:        { en: 'Tag',        es: 'Etiquetar' },
    clear:           { en: 'Clear',      es: 'Limpiar' },
    of_orders:       { en: 'orders',     es: 'pedidos' },
    open_chat:       { en: 'Open chat',  es: 'Ver chat' },

    // order statuses
    os_new:          { en: 'New',         es: 'Nuevo' },
    os_design:       { en: 'In design',   es: 'En diseño' },
    os_production:   { en: 'In production',es: 'En producción' },
    os_ready:        { en: 'Ready',       es: 'Listo' },
    os_delivered:    { en: 'Delivered',   es: 'Entregado' },
    os_cancelled:    { en: 'Cancelled',   es: 'Cancelado' },

    // priority
    pr_low:          { en: 'Low',     es: 'Baja' },
    pr_med:          { en: 'Medium',  es: 'Media' },
    pr_high:         { en: 'High',    es: 'Alta' },
    pr_urgent:       { en: 'Urgent',  es: 'Urgente' },

    // order detail
    line_items:      { en: 'Line items', es: 'Artículos' },
    activity_log:    { en: 'Activity log', es: 'Bitácora' },
    linked_chat:     { en: 'Linked WhatsApp chat', es: 'Chat de WhatsApp vinculado' },
    subtotal:        { en: 'Subtotal',  es: 'Subtotal' },
    qty:             { en: 'Qty',       es: 'Cant' },

    // kanban
    group_by:        { en: 'Group by',  es: 'Agrupar por' },
    by_status:       { en: 'Status',    es: 'Estado' },
    by_area:         { en: 'Area',      es: 'Área' },
    card_open:       { en: 'Open',      es: 'Abrir' },
    card_transfer:   { en: 'Transfer',  es: 'Transferir' },
    card_note:       { en: 'Add note',  es: 'Agregar nota' },
    notes_n:         { en: 'notes',     es: 'notas' },

    // agents
    agents_title:    { en: 'Agents & accounts', es: 'Agentes y cuentas' },
    invite_agent:    { en: 'Invite agent', es: 'Invitar agente' },
    role:            { en: 'Role',      es: 'Rol' },
    open_chats:      { en: 'Open chats',es: 'Chats abiertos' },
    open_orders:     { en: 'Open orders', es: 'Pedidos abiertos' },
    role_admin:      { en: 'Admin',     es: 'Admin' },
    role_agent:      { en: 'Agent',     es: 'Agente' },
    role_viewer:     { en: 'Viewer',    es: 'Lector' },
    online:          { en: 'Online',    es: 'En línea' },
    away:            { en: 'Away',       es: 'Ausente' },
    offline:         { en: 'Offline',   es: 'Desconectado' },
    deactivate:      { en: 'Deactivate',es: 'Desactivar' },
    edit_perms:      { en: 'Edit role', es: 'Editar rol' },

    // canned
    canned_title:    { en: 'Message templates', es: 'Plantillas de mensajes' },
    new_template:    { en: 'New template', es: 'Nueva plantilla' },
    shortcut:        { en: 'Shortcut',  es: 'Atajo' },
    variables:       { en: 'Variables', es: 'Variables' },
    insert:          { en: 'Insert',    es: 'Insertar' },
    cat_greetings:   { en: 'Greetings', es: 'Saludos' },
    cat_quote:       { en: 'Quotes',    es: 'Cotización' },
    cat_shipping:    { en: 'Shipping',  es: 'Envíos' },
    cat_payment:     { en: 'Payment',   es: 'Pagos' },
    cat_closing:     { en: 'Closing',   es: 'Cierre' },

    // settings
    settings_title:  { en: 'Settings',  es: 'Ajustes' },
    set_connection:  { en: 'WhatsApp connection', es: 'Conexión de WhatsApp' },
    set_areas:       { en: 'Areas & routing', es: 'Áreas y ruteo' },
    set_appearance:  { en: 'Appearance', es: 'Apariencia' },
    add_number:      { en: 'Add number', es: 'Agregar número' },
    default_routing: { en: 'Default routing', es: 'Ruteo por defecto' },
    new_area:        { en: 'New area',  es: 'Nueva área' },
    theme:           { en: 'Theme',     es: 'Tema' },
    language:        { en: 'Language',  es: 'Idioma' },
    light:           { en: 'Light',     es: 'Claro' },
    dark:            { en: 'Dark',      es: 'Oscuro' },

    // transfer dialog
    transfer_title: { en: 'Transfer', es: 'Transferir' },
    transfer_to:    { en: 'Transfer to', es: 'Transferir a' },
    to_agent:       { en: 'An agent',   es: 'Un agente' },
    to_area:        { en: 'An area',    es: 'Un área' },
    transfer_note:  { en: 'Note (optional)', es: 'Nota (opcional)' },
    transfer_note_ph:{ en: 'Add context for whoever picks this up…', es: 'Agrega contexto para quien lo retome…' },
    confirm_transfer:{ en: 'Transfer', es: 'Transferir' },

    // generic
    cancel:          { en: 'Cancel',    es: 'Cancelar' },
    save:            { en: 'Save',      es: 'Guardar' },
    create:          { en: 'Create',    es: 'Crear' },
    close:           { en: 'Close',     es: 'Cerrar' },
    confirm:         { en: 'Confirm',   es: 'Confirmar' },
    today:           { en: 'Today',     es: 'Hoy' },
    yesterday:       { en: 'Yesterday', es: 'Ayer' },
    now:             { en: 'now',       es: 'ahora' },

    // login
    login_sub:       { en: 'Customer chats & orders, in one place.', es: 'Chats y pedidos de clientes, en un solo lugar.' },
    email:           { en: 'Email',     es: 'Correo' },
    password:        { en: 'Password',  es: 'Contraseña' },
    sign_in:         { en: 'Sign in',   es: 'Iniciar sesión' },
    forgot:          { en: 'Forgot password?', es: '¿Olvidaste tu contraseña?' },
    remember:        { en: 'Keep me signed in', es: 'Mantener sesión' },

    // toasts
    toast_sent:      { en: 'Message sent', es: 'Mensaje enviado' },
    toast_resolved:  { en: 'Conversation resolved', es: 'Conversación resuelta' },
    toast_transferred:{ en: 'Transferred', es: 'Transferido' },
    toast_note:      { en: 'Note added', es: 'Nota agregada' },
    toast_status:    { en: 'Status updated', es: 'Estado actualizado' },
    toast_order:     { en: 'Order created', es: 'Pedido creado' },
    toast_new_msg:   { en: 'New WhatsApp message', es: 'Nuevo mensaje de WhatsApp' },
    toast_reconnected:{ en: 'WhatsApp reconnected', es: 'WhatsApp reconectado' },

    // customer 360 / expandable
    full_history:    { en: 'Full history', es: 'Historial completo' },
    customer_360:    { en: 'Customer 360', es: 'Cliente 360' },
    back_to_chat:    { en: 'Back to chat', es: 'Volver al chat' },
    everything_about:{ en: 'Everything about', es: 'Todo sobre' },
    tab_history:     { en: 'History', es: 'Historial' },
    stat_orders:     { en: 'Orders', es: 'Pedidos' },
    stat_open:       { en: 'Open', es: 'Abiertos' },
    stat_spent:      { en: 'Lifetime', es: 'Histórico' },
    open_conversation:{ en: 'Open conversation', es: 'Abrir conversación' },
    order_created_ev:{ en: 'Order created', es: 'Pedido creado' },
    no_history:      { en: 'No history yet', es: 'Sin historial aún' },

    // automations / workflows
    nav_flows:       { en: 'Automations', es: 'Flujos' },
    flows_title:     { en: 'Automations', es: 'Automatizaciones' },
    flows_sub:       { en: 'Send messages and move work automatically when something happens.', es: 'Envía mensajes y mueve trabajo automáticamente cuando algo sucede.' },
    new_flow:        { en: 'New automation', es: 'Nuevo flujo' },
    edit_flow:       { en: 'Edit automation', es: 'Editar flujo' },
    flow_name:       { en: 'Automation name', es: 'Nombre del flujo' },
    flow_when:       { en: 'When', es: 'Cuando' },
    flow_then:       { en: 'Then', es: 'Entonces' },
    flow_active:     { en: 'Active', es: 'Activo' },
    flow_paused:     { en: 'Paused', es: 'Pausado' },
    runs_count:      { en: 'runs', es: 'ejecuciones' },
    enabled_flows:   { en: 'Active automations', es: 'Flujos activos' },
    msgs_automated:  { en: 'Messages automated', es: 'Mensajes automatizados' },
    trg_order_status:{ en: 'an order moves to', es: 'un pedido pasa a' },
    trg_conv_status: { en: 'a conversation is marked', es: 'una conversación se marca' },
    trg_conv_created:{ en: 'a new conversation starts', es: 'inicia una nueva conversación' },
    trg_order_created:{ en: 'a new order is created', es: 'se crea un nuevo pedido' },
    act_send_template:{ en: 'send a WhatsApp template', es: 'enviar una plantilla de WhatsApp' },
    act_transfer_area:{ en: 'transfer to area', es: 'transferir al área' },
    act_assign_agent: { en: 'assign to an agent', es: 'asignar a un agente' },
    act_add_tag:      { en: 'add a tag', es: 'agregar una etiqueta' },
    act_notify_agent: { en: 'notify the assigned agent', es: 'notificar al agente asignado' },
    choose_template:  { en: 'Template', es: 'Plantilla' },
    choose_status:    { en: 'Status', es: 'Estado' },
    choose_area:      { en: 'Area', es: 'Área' },
    choose_agent:     { en: 'Agent', es: 'Agente' },
    automation_ran:   { en: 'Automation ran', es: 'Automatización ejecutada' },
    sent_to_chat:     { en: 'Template sent to chat', es: 'Plantilla enviada al chat' },
    flow_preview:     { en: 'Preview', es: 'Vista previa' },

    // business config / verticals
    nav_business:    { en: 'Business', es: 'Negocio' },
    biz_config:      { en: 'Business setup', es: 'Configuración del negocio' },
    biz_vertical:    { en: 'Business type', es: 'Tipo de negocio' },
    biz_vertical_sub:{ en: 'Pick your industry — it renames stages, areas and the work item across the app.', es: 'Elige tu giro — renombra etapas, áreas y el objeto de trabajo en toda la app.' },
    biz_object:      { en: 'Work item name', es: 'Nombre del objeto' },
    biz_stages:      { en: 'Stages', es: 'Etapas' },
    biz_stages_sub:  { en: 'The pipeline your work moves through.', es: 'El flujo por el que pasa tu trabajo.' },
    biz_areas:       { en: 'Areas / departments', es: 'Áreas / departamentos' },
    biz_fields:      { en: 'Custom fields', es: 'Campos personalizados' },
    biz_fields_sub:  { en: 'Extra data your team tracks on each customer or order.', es: 'Datos extra que tu equipo guarda en cada cliente o pedido.' },
    add_field:       { en: 'Add field', es: 'Agregar campo' },
    add_stage:       { en: 'Add stage', es: 'Agregar etapa' },
    applied:         { en: 'Applied', es: 'Aplicado' },

    // catalog
    nav_catalog:     { en: 'Catalog', es: 'Catálogo' },
    catalog_title:   { en: 'Products & services', es: 'Productos y servicios' },
    new_item:        { en: 'New item', es: 'Nuevo artículo' },
    col_sku:         { en: 'SKU', es: 'SKU' },
    col_category:    { en: 'Category', es: 'Categoría' },
    col_price:       { en: 'Price', es: 'Precio' },
    add_from_catalog:{ en: 'Add from catalog', es: 'Agregar del catálogo' },

    // payments
    nav_payments:    { en: 'Payments', es: 'Pagos' },
    pay_status:      { en: 'Payment', es: 'Pago' },
    pay_paid:        { en: 'Paid', es: 'Pagado' },
    pay_partial:     { en: 'Partial', es: 'Anticipo' },
    pay_pending:     { en: 'Pending', es: 'Pendiente' },
    charge:          { en: 'Charge', es: 'Cobrar' },
    send_pay_link:   { en: 'Send payment link', es: 'Enviar link de pago' },
    pay_link_sent:   { en: 'Payment link sent to chat', es: 'Link de pago enviado al chat' },
    mark_paid:       { en: 'Mark as paid', es: 'Marcar pagado' },
    collected_total: { en: 'Collected', es: 'Cobrado' },
    pending_total:   { en: 'Pending', es: 'Por cobrar' },

    // agenda
    nav_agenda:      { en: 'Agenda', es: 'Agenda' },
    agenda_title:    { en: 'Appointments', es: 'Citas' },
    new_appt:        { en: 'New appointment', es: 'Nueva cita' },
    appt_today:      { en: 'Today', es: 'Hoy' },
    appt_tomorrow:   { en: 'Tomorrow', es: 'Mañana' },
    appt_confirmed:  { en: 'Confirmed', es: 'Confirmada' },
    appt_pending:    { en: 'Pending', es: 'Pendiente' },
    appt_done:       { en: 'Done', es: 'Atendida' },

    // campaigns
    nav_campaigns:   { en: 'Campaigns', es: 'Campañas' },
    campaigns_title: { en: 'Broadcasts & campaigns', es: 'Difusión y campañas' },
    new_campaign:    { en: 'New broadcast', es: 'Nueva difusión' },
    segment:         { en: 'Audience', es: 'Audiencia' },
    recipients:      { en: 'recipients', es: 'destinatarios' },
    send_now:        { en: 'Send broadcast', es: 'Enviar difusión' },
    campaign_sent:   { en: 'Broadcast queued', es: 'Difusión en cola' },
    seg_all:         { en: 'All contacts', es: 'Todos los contactos' },
    sent_label:      { en: 'Sent', es: 'Enviada' },
    draft_label:     { en: 'Draft', es: 'Borrador' },
    scheduled_label: { en: 'Scheduled', es: 'Programada' },
    delivered_rate:  { en: 'Delivered', es: 'Entregados' },
    read_rate:       { en: 'Read', es: 'Leídos' },

    // reports
    nav_reports:     { en: 'Reports', es: 'Reportes' },
    reports_title:   { en: 'Reports', es: 'Reportes' },
    rep_sales:       { en: 'Sales (30d)', es: 'Ventas (30d)' },
    rep_orders:      { en: 'Orders', es: 'Pedidos' },
    rep_resp:        { en: 'Avg. response', es: 'Resp. promedio' },
    rep_resolved:    { en: 'Resolved chats', es: 'Chats resueltos' },
    rep_by_stage:    { en: 'By stage', es: 'Por etapa' },
    rep_by_area:     { en: 'By area', es: 'Por área' },
    rep_by_agent:    { en: 'Top agents', es: 'Agentes destacados' },
    rep_sales_trend: { en: 'Sales — last 7 days', es: 'Ventas — últimos 7 días' },
  };

  function tr(key, lang) {
    const e = T[key];
    if (!e) return key;
    return e[lang] || e.en || key;
  }
  function L(obj, lang) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] || obj.en || obj.es || '';
  }
  window.HT_T = T;
  window.tr = tr;
  window.L = L;
})();
