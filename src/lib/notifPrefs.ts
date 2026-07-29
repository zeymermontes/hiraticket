/** Qué avisa la app, por usuario (0068).
 *
 *  Vive en profiles y no en el navegador: son preferencias de la persona, no del equipo. Quien las
 *  apaga en la computadora de la oficina espera que sigan apagadas en su laptop.
 *
 *  El sonido y las notificaciones del sistema NO están aquí a propósito: esos sí dependen del
 *  dispositivo (permiso del navegador, si tiene bocinas) y siguen en localStorage.
 */
export interface NotifPrefs {
  all: boolean;         // interruptor maestro: en off no avisa nada
  unassigned: boolean;  // mensajes en chats que nadie ha tomado
  mine: boolean;        // mensajes en chats asignados a mí
  internal: boolean;    // chat de equipo y directos
  mentions: boolean;    // @menciones (equipo y notas)
  calls: boolean;       // llamadas de WhatsApp
  transfers: boolean;   // cuando alguien me transfiere un chat
}

/** Todo encendido: quien nunca entró a Ajustes debe seguir recibiendo lo de siempre. */
export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  all: true, unassigned: true, mine: true, internal: true, mentions: true, calls: true, transfers: true,
};

/** Normaliza lo que venga de la base (jsonb suelto) a la forma completa. */
export function parseNotifPrefs(raw: unknown): NotifPrefs {
  const o = (raw ?? {}) as Partial<Record<keyof NotifPrefs, unknown>>;
  const b = (k: keyof NotifPrefs) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_NOTIF_PREFS[k]);
  return { all: b("all"), unassigned: b("unassigned"), mine: b("mine"), internal: b("internal"), mentions: b("mentions"), calls: b("calls"), transfers: b("transfers") };
}

/** El maestro manda: en off, nada pasa. */
export function notifOn(p: NotifPrefs, key: Exclude<keyof NotifPrefs, "all">): boolean {
  return p.all && p[key];
}
