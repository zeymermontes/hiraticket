/**
 * Qué versión de la app es esta.
 *
 * Render expone el commit desplegado en RENDER_GIT_COMMIT, y es lo único que cambia con cada
 * despliegue sin que haya que acordarse de subir un número a mano. Vacío en desarrollo, y ahí la
 * comprobación de versión se queda callada —- que es lo correcto: en local se recarga a mano.
 */
export const BUILD_ID = (process.env.RENDER_GIT_COMMIT ?? process.env.NEXT_PUBLIC_BUILD_ID ?? "").slice(0, 12);
