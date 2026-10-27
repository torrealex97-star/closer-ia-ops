# ADR-016 — Avisos del motor: en el panel y por correo al propietario (Resend)

Estado: aceptada e implementada (2026-10-27) · Evidencia: *tested* con servicios simulados (Supabase y Resend simulados); **no verified** con la clave real de Resend ni con dominio verificado, y la migración `20261029_engine_alerts.sql` está **pendiente de aplicar** por el propietario.

## Contexto
En la sesión 123 se midió que el motor cloud puede estar **publicado y en pausa por cuota** (la plataforma responde `HTTP 429` con texto plano) sin que nadie se entere: la causa se declaraba solo dentro de las pestañas «Resumen» y «Fuentes», así que el operador tenía que abrir el panel y esa pestaña para descubrir que no se estaban recogiendo ofertas. El mismo hueco existe si el motor simplemente deja de responder.

El propietario pidió: «Avisa en el panel (y por correo si hay clave) cuando el motor entre en pausa por cuota o deje de responder, sin tener que abrir la pestaña».

`AGENTS.md` exige configuración y autorización explícitas antes de enviar mensajes automáticos, y la migración de escrituras de D1 del motor está cerca de su techo, así que el aviso no puede depender de escribir en el motor.

## Decisión 1 — Una sola sonda y un solo texto de cada estado
`apps/web/lib/engineHealth.ts` es la única forma de sondear el motor y de nombrar su estado (`ok`, `allowance`, `timeout`, `down`, `unconfigured`). La usan la ruta del panel «Fuentes» (que antes tenía su propia copia de la clasificación), el aviso y el cron. **Una pausa por cuota no es una caída**: `429` + «allowance» se declara como pausa (se reactiva sola al reiniciarse la cuota y no se pierde ninguna oferta); cualquier otra cosa es «no responde». Un estado desconocido nunca se presenta como bueno.

## Decisión 2 — El aviso vive en el panel, en cualquier pestaña
`apps/web/components/EngineAlertBanner.tsx` se pinta en el marco del panel (no dentro de una pestaña) y solo cuando el motor está mal: un aviso permanente no se lee. Muestra la causa, cuándo se detectó, la última comprobación y **qué se ha hecho con el correo** (enviado a quién o por qué no), con dos acciones: «Comprobar ahora» y «Ver en Fuentes». Con el motor bien no ocupa sitio; si no se puede comprobar, lo dice como hueco («no se pudo comprobar»), no como si estuviera bien.

## Decisión 3 — Correo solo al propietario, solo si hay clave, una vez por estado
- **Destinatario**: los usuarios con rol `owner` de `public.admin_users`. Nunca alumnas, nunca terceros.
- **Condición**: la clave de Resend guardada (cifrada) en Panel → APIs. Sin clave no se envía nada y el panel dice por qué («por correo si hay clave»).
- **Remitente**: `RESEND_FROM` si está definida; si no, `onboarding@resend.dev`, que Resend solo permite escribir al correo de la propia cuenta (si el propietario usa otro, el envío se rechaza y el panel muestra el mensaje del proveedor).
- **Disparo**: solo cuando el estado **cambia** — avería nueva, empeoramiento (pausa → no responde) o recuperación. Un mismo estado no se repite. Si el aviso anterior no llegó a salir, el siguiente intento lo reintenta.
- **Contenido**: qué pasa, qué implica (en la pausa, que no se pierde ninguna oferta y que las alumnas siguen viendo las externas aprobadas), desde cuándo y dónde mirarlo. Sin claves, sin datos de alumnas, sin promesas.

## Decisión 4 — Historial propio, y sin historial no se envía
`public.engine_alerts` (una fila por comprobación, con `since` de la racha, `http_status`, el texto de causa y a quién/cuándo se avisó) es lo que hace posible «una vez por estado». Solo se escribe desde el servidor (service role; RLS sin políticas y sin privilegios para `anon`/`authenticated`, como el resto de tablas del panel). Si la tabla no está (migración sin aplicar) o no se puede leer, **no se envía correo**: sin registro se repetiría en cada comprobación; el panel declara el estado real y el motivo de no enviar. Un envío o una escritura fallidos **nunca** se cuentan como aviso hecho.

## Decisión 5 — La comprobación automática va con la recogida diaria
El cron de `/api/cron/collect` comprueba el motor **al principio y fuera del presupuesto de 40 s** (una llamada de ≤ 8 s; el total sigue muy por debajo de los 60 s de `maxDuration`), con el mismo camino que el botón «Comprobar ahora». El plan gratuito de Vercel solo admite crons diarios: con **Vercel Pro** se puede añadir una pasada cada hora (una línea de `apps/web/vercel.json`) sin tocar el código.

## Consecuencias
El operador se entera de una pausa o una caída sin abrir la pestaña, y el propio aviso dice qué se ha hecho con el correo. El aviso es explicable y reproducible desde el historial. Coste: nada, salvo los correos (Resend gratuito: 3.000/mes, cuota compartida con lo recibido; a lo sumo uno por cambio de estado). Queda pendiente: aplicar la migración, verificar el dominio y fijar `RESEND_FROM`, y decidir si se quiere la pasada horaria.

## Fuera de alcance
- **Avisos a alumnas** (correo o WhatsApp): siguen exigiendo orden expresa del propietario (Prompt 11 de `docs/OWNER_GUIDE.md`).
- **Vigilancia de otras piezas** (Supabase, Vercel, proveedores de pago): este aviso cubre el motor cloud; el resto se ve en la pestaña Fuentes.
- **Auto-remediación** (reiniciar el motor, cambiar de plan, reintentar la recogida): nada se toca solo.
