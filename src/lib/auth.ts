import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/** El usuario de la sesión, una sola vez por petición.
 *
 *  `supabase.auth.getUser()` NO lee una cookie: valida el JWT contra el servidor de Auth de
 *  Supabase, o sea un viaje de red en cada llamada. Y se llamaba 3 o 4 veces por render — el
 *  layout, la página y getMyBusiness cada uno por su cuenta.
 *
 *  cache() de React lo colapsa a uno dentro de la misma petición. No es caché entre peticiones:
 *  cada request revalida, así que la seguridad no cambia.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
