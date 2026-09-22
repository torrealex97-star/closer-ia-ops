# P05A_GROQ_PROVIDER — Groq y LLMProvider

Estado: parcialmente implementada. Adaptadores, configuración visible, caché por proveedor y migración heredada entregados; pruebas HTTP/local y browser correctas. Pendientes presupuestos monetarios/reservas, rate limiting coordinado, configuración por tarea, canary real y benchmark ES/EN. No declarar fase completa. Ver STATUS.

## Dependencias y alcance

Primer incremento pendiente. Depende de la base local y migraciones v2 existentes.
Extraer interfaz y encapsular OpenAI actual; añadir Groq default para nuevas configuraciones sin activar gasto; configuración por tarea/organización; structured output, caché, intentos, presupuesto y telemetría de 16_LLM_PROVIDER_GROQ. Preservar generaciones y credenciales heredadas sin reutilizarlas.

## Verificación

HTTP→API→DB→worker con servidor de contrato local; 429/auth/model unavailable/timeout incierto/schema/evidence; migración y reinicio sin doble cargo. Canary Groq solo con clave WDC y gasto autorizado; benchmark ES/EN independiente.

## Aceptación

Groq produce DTO validado con evidencia; historial OpenAI intacto; límites atómicos; no fallback silencioso; métricas de tokens/coste/latencia; STATUS distingue CI de canary.

Referencias: [MASTER SPEC](../00_MASTER_SPEC.md), [plan vigente](../../PLAN.md), [estado real](../../STATUS.md). Registrar archivos, migraciones, contratos, tests, costes y limitaciones al terminar. No declarar verde un canary sin haberlo ejecutado.
