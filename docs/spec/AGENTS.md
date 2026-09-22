# AGENTS.md — instrucciones para Codex y otros coding agents

## Fuente de verdad

Antes de modificar código:
1. leer `00_MASTER_SPEC.md`;
2. leer el documento específico del área;
3. leer la fase activa;
4. leer ADRs relevantes.

No inventar requisitos fuera de esos documentos.

## Modo de trabajo

- Una fase por PR/cambio principal.
- No implementar fases futuras “porque es fácil”.
- Antes de código, listar archivos que cambiarán.
- Después de código, ejecutar tests requeridos.
- Actualizar documentación si un contrato cambia.
- Si una decisión contradice el spec, crear/proponer un ADR; no cambiarla silenciosamente.

## Reglas arquitectónicas

- ningún connector escribe directamente en `jobs`;
- todo input externo entra como `raw_item`;
- `raw_items` no se actualizan;
- `job_posting` siempre apunta a raw;
- `job` siempre tiene al menos un posting;
- source y provider son conceptos distintos;
- provider-specific fields no contaminan el dominio; quedan raw/provider metadata;
- no poner lógica source-specific en SearchOrchestrator;
- no exponer secrets al frontend;
- no permitir que un source failure marque todo search como failed;
- no hacer merge semántico agresivo;
- OpenAPI backend es fuente de tipos API.

## Testing

Todo cambio requiere el nivel correspondiente:
- parser -> fixture/unit;
- connector -> contract;
- DB -> migration/integration;
- API -> request/response tests;
- UI path -> component/E2E;
- bug -> regression test.

## Migrations

- forward-only;
- nunca editar migration ya aplicada;
- índices/constraints explícitos;
- RLS/policies forman parte de la migration.

## Error handling

Usar error codes estables.
No devolver stack traces ni secretos.

## Provider integrations

- timeouts obligatorios;
- bounded retries;
- idempotency;
- coste/logging;
- fixtures de schema;
- healthcheck.

## Final de cada fase

Entregar:
- resumen;
- archivos modificados;
- comandos de test;
- resultados;
- deuda conocida;
- criterios de aceptación cumplidos/no cumplidos.

No declarar fase terminada si queda un criterio de aceptación rojo.

## Revisión WDC / Groq

Leer documentos 16–18 y ADR-007 cuando afecten al área. default_llm_provider=groq es objetivo; no afirmar migración hecha hasta tests/canary. Student DTO separado por allowlist; nunca inferir relación directa de URL/empresa. Mantener source/provider/raw íntegros en administración. Actualizaciones documentales se validan con enlaces/consistencia, sin declarar tests runtime no ejecutados.
