# IA: Groq principal y proveedores reemplazables

## Hermes y Manus como AgenticGapFillProvider (ADR-009)

Hermes y Manus no son scrapers generales ni proveedores de adquisición por defecto. Se definen como `AgenticGapFillProvider` de nivel superior al premium: solo actúan cuando el Quality Gate determina un gap que las capas FREE/LOW/MEDIUM/HIGH no cerraron, y reciben la brecha descrita en términos de negocio ("Find up to 10 current remote Spanish-speaking closer opportunities in US companies"), no "busca todo en todas partes". Hermes cubre gap filling dirigido (careers pages, empresas, vacantes específicas); Manus queda reservado como deep research excepcional. Si el gap se cierra, STOP. El gasto pasa por el mismo presupuesto diario y la misma trazabilidad que cualquier proveedor. Sin implementación actual: requisito de diseño, no código entregado.

Fecha: 2026-09-22. Decisión aprobada; P05A parcialmente entregada. El código local ya permite conectar Groq (principal) u OpenAI mediante LLMProvider para análisis individual. La especificación de procesamiento masivo, límites monetarios, cuotas y configuración por tarea de abajo sigue pendiente. Ninguna generación real Groq se ha validado sin clave WDC.

## Contrato de dominio

`default_llm_provider = groq`. Toda función IA, incluidas futuras sesiones de preparación, resuelve el proveedor a través de un registro. Groq no aparece en modelos de oferta ni en componentes de alumnas. Un modelo con prefijo `openai/` alojado en Groq sigue siendo proveedor Groq; no utiliza la clave de OpenAI.

```python
class LLMProvider(Protocol):
    async def capabilities(self) -> ProviderCapabilities: ...
    async def generate_structured(self, request: LLMRequest) -> LLMResult: ...
    async def healthcheck(self) -> HealthResult: ...
```

Request: organization_id, generation_id, task, model, input, input_hash, schema, schema_version, prompt_version, max_output_tokens, deadline, budget_reservation_id. No secretos.
Result: provider, model, provider_request_id, parsed_output, finish_reason, usage (input/output/total y cached si reportado), latency_ms, actual_cost nullable, estimated_cost, pricing_version, warnings.
Errores normalizados: auth, permission, model_unavailable, rate_limited, invalid_schema, invalid_output, timeout_uncertain, budget_exceeded, provider_unavailable.
Capabilities explicita structured_strict, json_mode, streaming y tools; no asumir paridad por compatibilidad OpenAI.

## Modelos por tarea

Propuesta inicial a evaluar, no benchmark propio. El catálogo oficial consultado enumera GPT-OSS 20B y 120B como modelos de producción. No fijar tarifas ni velocidades promocionales como SLA. [Modelos Groq](https://console.groq.com/docs/models).

| Tarea | Modelo inicial | Regla |
|---|---|---|
| Extracción, normalización, idiomas, rol, requisitos, salario/comisión | openai/gpt-oss-20b | Un JSON combinado por candidato ambiguo |
| Clasificación y scoring semántico | openai/gpt-oss-20b | Reutilizar extracción; no nueva llamada si basta |
| Resumen, contenido alumna y borrador para publicar | openai/gpt-oss-20b | Solo hechos aceptados; render determinista cuando baste |
| Ambigüedad difícil de condiciones o equivalencia | openai/gpt-oss-120b | Escalado acotado por política/budget |
| Apoyo a dedupe | openai/gpt-oss-120b | Solo pares candidatos; nunca fusionar por decisión aislada del LLM |

Evaluar ambos sobre el mismo gold set ES/EN antes de adoptar umbrales. Menor latencia no sustituye calidad. Roleplay/entrevista tendrán perfil de tarea propio, sin construirlo en esta fase.

## Structured outputs y evidencia

Adaptador Groq usa `https://api.groq.com/openai/v1/chat/completions`, `response_format.type=json_schema`, `strict=true` cuando la capability lo permita, sin streaming ni tools en este recorrido. 20B y 120B figuran con soporte strict; objetos con `additionalProperties:false`, campos required y valores nullable para desconocidos. [Structured outputs](https://console.groq.com/docs/structured-outputs).

El esquema valida forma, no verdad. Validar también citas/offsets contra raw, monedas/periodos, fechas, país permitido y coherencia entre campos. Guardar idioma original y traducción por separado. Si una respuesta se trunca o es incoherente, no publicar: needs_review. No completar salarios, empresa, actividad ni relación WDC por inferencia. Inputs externos son datos no confiables; ninguna instrucción de la oferta puede ejecutar herramientas o cambiar reglas.

## Configuración propuesta (no leída todavía por la app)

```dotenv
DEFAULT_LLM_PROVIDER=groq
GROQ_API_KEY=<server-secret>
GROQ_MODEL_EXTRACT=openai/gpt-oss-20b
GROQ_MODEL_PRESENT=openai/gpt-oss-20b
GROQ_MODEL_REVIEW=openai/gpt-oss-120b
LLM_ENABLED=false
LLM_TIMEOUT_SECONDS=30
LLM_MAX_CONCURRENCY=4
LLM_MAX_ATTEMPTS=2
LLM_MAX_INPUT_TOKENS=3000
LLM_MAX_OUTPUT_TOKENS=900
LLM_RUN_MAX_CANDIDATES=200
LLM_RUN_MAX_TOKENS=1000000
LLM_RUN_MAX_COST_USD=1
LLM_DAILY_MAX_COST_USD=5
LLM_FALLBACK_PROVIDERS=
```

Valores iniciales de producto para calibrar, no límites del proveedor ni compromisos de gasto. Límites diarios/run se reservan atómicamente por organización; gana el más restrictivo. Tarifas configuradas/versionadas obligatorias para habilitar procesamiento masivo; si faltan, bloquear estimación monetaria en lugar de poner coste cero. Credencial por organización referenciada por secret_ref; en local se podrá usar clave propia WDC en archivo protegido. No migrar ni reutilizar automáticamente secretos OpenAI.

Configuración adicional obligatoria al activar: RPM, RPD, TPM, TPD efectivos de la cuenta y, si aplica, ITPM/OTPM. Semáforo por proveedor/modelo/cuenta más token bucket compartido entre workers. Los headers de solicitudes de Groq pueden representar cuota diaria, no RPM. Respetar Retry-After y resets; no asumir límites por modelo a partir del plan público. [Rate limits](https://console.groq.com/docs/rate-limits).

## Retries, caché y recuperación

Máximo dos intentos totales por tarea, incluido escalado/reparación. 429 explícito permite reencolar con Retry-After y jitter dentro de deadline y presupuesto. Auth/permission/schema inválido no se reintentan. Timeout tras envío, desconexión o 5xx con aceptación incierta: estado uncertain, reconciliar o revisión; no replay automático potencialmente facturable. Un fallo confirmado antes del envío puede reintentarse. Desactivar retries ocultos del SDK/cliente para no multiplicar intentos.

Persistir generation y reserva antes de red. Caché por org + task + input_hash + provider + model + prompt_version + schema_version + configuración de generación. Provider_request_id y cada intento separados. Respuesta válida reutilizable; fallo no es resultado exitoso ni disparador de bucle automático. Reinicio del worker no duplica llamadas inciertas. Fallback futuro opt-in, con credenciales propias, misma evidencia/schema y presupuesto; no cambiar silenciosamente de proveedor.

## Rendimiento y coste

Pipeline: dedupe exacto → parsers y filtros baratos → candidatos ambiguos → una extracción combinada → validación → WDC Opportunity → renderer/caché. Lotes de cola pequeños; una oferta por petición inicialmente, evitando mezclar evidencias. Compartir resultado entre clasificación, resumen y presentación. No enviar HTML, navegación, historial de chat ni CV para clasificar ofertas.

Objetivo medible: 200 candidatos en <=5 minutos p95 en cuenta con capacidad suficiente; primeros resultados <=60 s. Registrar candidatos descartados sin IA, enviados, cache hits, latencia de cola/red/validación, tokens y coste por oportunidad útil. No prometer el objetivo en plan limitado. Referencia de dimensionado propia: 200 × (1.200 entrada + 400 salida) = 320.000 tokens; con 8.000 TPM serían al menos 40 minutos, incluso sin otros cuellos. Programar progreso parcial y pausar por cuota en vez de fallar toda la búsqueda.

## Observabilidad y migración

ai_generations conserva registros anteriores con provider=openai, sin reinterpretar métricas. Añadir llm_attempts y reservas con migraciones forward-only; índice de caché incluye proveedor. Logs: org/run/generation/attempt, task, modelo, versiones, uso, latencia, error y estado de cuota; nunca clave ni raw completo. Reportar coste desconocido como null y distinguir estimado/reportado.

Pasos P05A: extraer protocolo → encapsular adaptador OpenAI existente → añadir Groq → migrar historial/config sin activar gasto → pruebas HTTP/DB → canary opcional con clave WDC → benchmark ES/EN → habilitar Groq por defecto para nuevas tareas autorizadas. No borrar generaciones antiguas.

## Sala de práctica (rol de venta y entrevista) — 2026-10-22

Perfil de tarea propio, implementado como ruta de servidor de la web (`POST /api/practice`), no en el motor de recogida: catálogo y práctica no comparten datos ni permisos.

- Ocho situaciones ficticias declaradas con nivel (suave / real / dura): llamada en frío, objeción de precio, «lo tengo que pensar», objeción de socio, ataque al ego, entrevista de closer, de setter y objeción de sector. El prompt de cada personaje vive solo en servidor (`app/api/practice/prompts.ts`); el navegador recibe únicamente el catálogo visible.
- Cada personaje tiene tres niveles de resistencia (circunstancias → terceros → el yo, o su equivalente en entrevista), disparadores que lo desarman o lo cierran y una condición explícita para ceder. El nivel avanza cada tres respuestas de la alumna (`stageFor`, determinista) y no se anuncia en la conversación. La regla de silencio se aplica: rellenar después del precio invita al ataque.
- Apagada por defecto: sin `GROQ_API_KEY` responde 503 y la interfaz lo dice. Nunca se simula una conversación sin proveedor ni se fabrica una réplica. **Acceso abierto desde 2026-10-24**: se retiró el código de cohorte por petición del operador; el gasto queda contenido por los topes de turnos por IP y globales, que son best-effort en serverless.
- Modelo en allowlist (`openai/gpt-oss-20b` por defecto; `openai/gpt-oss-120b` permitido), 260 tokens por turno, 900 en el feedback, timeout 20 s, sin streaming ni tools.
- Límites: 24 turnos y 18.000 caracteres por petición; 60 turnos/día por IP y 400 por instancia/día (`PRACTICE_DAILY_TURNS`). La interfaz cierra la conversación a los 20 turnos para que el feedback siempre quepa (con el tope anterior de 16 una práctica larga quedaba sin réplica ni feedback posible). En serverless son best-effort: sin código de cohorte, la barrera real es el tope por llamada y el límite diario por IP e instancia.
- Feedback con `json_schema` estricto (`summary`, `focus`, `strengths`, `improvements`, `axes`, `model`, `next`). Cuatro ejes por tipo con nota 0-100, nota cualitativa y cita; si falta un eje, no se acepta el feedback (502). Las **entrevistas por perfil** usan la rúbrica WDC de **seis criterios con peso** (confianza 25, claridad 20, evidencia 20, objeciones 15, encaje 10, iniciativa 10) y la nota global es su media ponderada, calculada en servidor. Una cita que no aparezca literalmente en los mensajes de la alumna se descarta en servidor: el feedback no puede demostrar algo que no se dijo.
- La nota global es la **media de los ejes**, calculada en servidor (ponderada cuando la rúbrica trae pesos); el modelo no devuelve una nota propia. Se presenta siempre como **estimación docente**, no como nota oficial ni probabilidad.
- Señales de estilo deterministas y sin coste (`app/api/practice/signals.ts`): relleno tras el precio, «pero» tras validar, falta de siguiente paso o de preguntas, mensaje largo, muletillas y respuestas mínimas. Se devuelven con la frase literal que las dispara, como observaciones que no restan nota.
- Datos: la conversación no se persiste en servidor ni en D1; el historial (8 prácticas) vive en el navegador. No se envía nada a empresas ni se registra una candidatura.
- Producto: es un simulacro formativo. El feedback no evalúa la candidatura ni decide nada sobre un proceso; la interfaz lo declara. La sala no pide credenciales: es material formativo público del enlace.
