// Minimal typed i18n for the production shell. Mirrors the prototype's ES/EN
// strings; extend as views are ported. The prototype's full i18n.js lives in
// /prototype for reference.

export type Lang = "es" | "en";

export const STRINGS = {
  nav_chat: { es: "Chat", en: "Chat" },
  nav_orders: { es: "Pedidos", en: "Orders" },
  nav_kanban: { es: "Tablero", en: "Board" },
  nav_agenda: { es: "Agenda", en: "Agenda" },
  nav_catalog: { es: "Catálogo", en: "Catalog" },
  nav_campaigns: { es: "Campañas", en: "Campaigns" },
  nav_reports: { es: "Reportes", en: "Reports" },
  nav_flows: { es: "Flujos", en: "Flows" },
  nav_agents: { es: "Agentes", en: "Agents" },
  nav_canned: { es: "Plantillas", en: "Templates" },
  nav_business: { es: "Negocio", en: "Business" },
  nav_settings: { es: "Ajustes", en: "Settings" },

  search_ph: { es: "Buscar chats, pedidos, contactos…", en: "Search chats, orders, contacts…" },
  new_order: { es: "Nuevo pedido", en: "New order" },
  connected: { es: "Conectado", en: "Connected" },
  reconnecting: { es: "Reconectando", en: "Reconnecting" },
  disconnected: { es: "Desconectado", en: "Disconnected" },
  reconnect: { es: "Reconectar", en: "Reconnect" },
  online: { es: "En línea", en: "Online" },
  role_admin: { es: "Admin", en: "Admin" },
  light: { es: "Claro", en: "Light" },
  dark: { es: "Oscuro", en: "Dark" },
  sign_out: { es: "Cerrar sesión", en: "Sign out" },

  // login
  login_welcome: { es: "Bienvenido de vuelta", en: "Welcome back" },
  login_sub: { es: "Entra para gestionar tus chats y pedidos.", en: "Sign in to manage your chats and orders." },
  email: { es: "Correo", en: "Email" },
  password: { es: "Contraseña", en: "Password" },
  remember: { es: "Recuérdame", en: "Remember me" },
  forgot: { es: "¿Olvidaste tu contraseña?", en: "Forgot password?" },
  sign_in: { es: "Iniciar sesión", en: "Sign in" },
  sign_up: { es: "Crear cuenta", en: "Sign up" },
  need_account: { es: "¿No tienes cuenta?", en: "No account?" },
  have_account: { es: "¿Ya tienes cuenta?", en: "Have an account?" },

  // orders view
  orders_title: { es: "Pedidos", en: "Orders" },
  col_order: { es: "Pedido", en: "Order" },
  col_customer: { es: "Cliente", en: "Customer" },
  col_status: { es: "Estado", en: "Status" },
  col_area: { es: "Área", en: "Area" },
  col_agent: { es: "Agente", en: "Agent" },
  col_total: { es: "Total", en: "Total" },
  col_updated: { es: "Actualizado", en: "Updated" },
  empty_orders: { es: "No hay pedidos todavía.", en: "No orders yet." },
  coming_soon: { es: "En construcción — próximamente.", en: "Under construction — coming soon." },
} as const;

export type StringKey = keyof typeof STRINGS;

export function tr(key: StringKey, lang: Lang): string {
  const entry = STRINGS[key];
  return entry ? entry[lang] : (key as string);
}
