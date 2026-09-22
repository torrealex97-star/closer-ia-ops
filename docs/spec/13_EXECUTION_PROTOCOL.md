# Execution Protocol for Claude Code / Codex

## Objetivo

Implementar el MVP por incrementos verificables sin que un agente reinterpreté o expanda el alcance.

## Regla de fase activa

Solo una fase activa.

El agente recibe:
1. `00_MASTER_SPEC.md`
2. `AGENTS.md`
3. la fase activa
4. ADRs relevantes

No necesita leer todo el repositorio documental en cada tarea salvo que la fase lo indique.

## Prompt inicial recomendado

```text
Implementa la fase <PHASE_FILE> de este repositorio.

Antes de escribir código:
1. lee 00_MASTER_SPEC.md;
2. lee AGENTS.md;
3. lee <PHASE_FILE>;
4. inspecciona el código actual;
5. enumera brevemente los cambios que harás.

Después:
- implementa solo el scope de esa fase;
- ejecuta los tests indicados;
- corrige fallos;
- no declares completado ningún acceptance criterion que no hayas verificado;
- al finalizar entrega un resumen de archivos, tests y criterios.
```

## Branch/commit strategy

Sugerido:

```text
main
  └── phase/00-foundation
  └── phase/01-domain-db
  └── phase/02-orchestrator
  ...
```

Una fase puede usar varios commits, pero debe cerrar en estado verde.

## Checkpoint al terminar fase

Guardar en PR/issue:

```text
Phase:
Status:
Acceptance criteria:
Tests:
Migrations:
New env vars:
New external dependencies:
Known limitations:
ADRs added/changed:
Next phase blockers:
```

## Cambios de arquitectura

Si durante la implementación aparece una razón real para cambiar una decisión:
1. no editar el spec silenciosamente;
2. crear ADR nuevo o superseding ADR;
3. explicar tradeoff;
4. actualizar spec solo después.

## Integraciones externas

Antes de fijar un provider:
- volver a comprobar documentación;
- confirmar output actual;
- ejecutar canary;
- guardar fixture;
- registrar actor/API id en config;
- definir fallback.

No convertir un resultado de prueba manual en supuesto permanente.

## Definition of Ready para fase de connector

Debe existir:
- source code;
- provider candidate;
- query mapping;
- expected output fields;
- timeout;
- result cap;
- fixtures target;
- healthcheck strategy.

## Definition of Done global

Código + tests + docs + migration + observability necesaria.

“Funciona en mi máquina” no cierra una fase.
