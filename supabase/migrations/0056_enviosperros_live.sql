-- ============================================================
-- Hiraticket — Envíos Perros goes live (V3 API, validated against their official Insomnia kit).
--   Every catalogue plugin is now a real integration. Bearer API key + origin address on the
--   plugin config; labels are paid from the Envíos Perros prepaid balance.
-- ============================================================

update public.plugins set
  status = 'available',
  description = 'Genera guías de envío con Estafeta, Redpack, J&T y más a precio preferencial, desde cada pedido y con rastreo al cliente.',
  config_schema = '[
    {"key":"api_key","label":"API Key (Bearer token)","type":"secret","required":true},
    {"key":"staging","label":"Ambiente de pruebas (staging)","type":"toggle"},
    {"key":"origin_name","label":"Remitente (nombre)","type":"text","required":true},
    {"key":"origin_phone","label":"Remitente (teléfono, 10 dígitos)","type":"text","required":true},
    {"key":"origin_street","label":"Origen: calle y número","type":"text","required":true},
    {"key":"origin_colonia","label":"Origen: colonia","type":"text","required":true},
    {"key":"origin_zip","label":"Origen: código postal","type":"text","required":true}
  ]'::jsonb,
  guide = '[
    {"title":"Crea tu cuenta en Envíos Perros","body":"Regístrate y valida tu identidad para desbloquear todas las paqueterías.","url":"https://app.enviosperros.com/register"},
    {"title":"Copia tu API Key","body":"En Integraciones → tarjeta \"Conexión vía API REST\" pulsa Ver detalles y genera/copia tu token. Para probar sin costo usa una cuenta del ambiente staging (staging-app.enviosperros.com) y activa el toggle de pruebas en Configurar.","url":"https://app.enviosperros.com/integrations"},
    {"title":"Agrega saldo","body":"Las guías se pagan con el saldo prepagado de tu cuenta de Envíos Perros — recarga antes de generar."},
    {"title":"Configura credenciales y origen","body":"Pega la API Key en Configurar y llena la dirección de ORIGEN (remitente, teléfono a 10 dígitos, calle, colonia y CP)."},
    {"title":"Genera tu primera guía","body":"Abre un pedido → bloque Envío → Generar guía: elige la dirección del cliente, peso y medidas, cotiza y elige paquetería. La etiqueta PDF y el rastreo quedan en el pedido, con aviso al cliente por WhatsApp en un clic."}
  ]'::jsonb
where id = 'enviosperros';
