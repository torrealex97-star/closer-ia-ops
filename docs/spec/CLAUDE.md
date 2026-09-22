# CLAUDE.md — guía para Claude Code

Lee primero:
- `00_MASTER_SPEC.md`
- `AGENTS.md`
- el archivo de `phases/` que se indique.

Trata `AGENTS.md` como reglas obligatorias del repositorio.

## Proceso recomendado por tarea

1. Resume el objetivo de la fase en <= 10 bullets.
2. Inspecciona el repo antes de crear estructuras duplicadas.
3. Implementa el camino vertical más pequeño que cumpla criterios.
4. Ejecuta lint/typecheck/tests relevantes.
5. Corrige fallos.
6. Actualiza docs/ADR solo cuando una decisión cambie.
7. Reporta exactamente qué criterios quedaron verdes.

Evita:
- abstraer antes de tener dos implementaciones reales;
- introducir Redis/Kafka/Elastic en MVP;
- meter provider payloads en modelos de dominio;
- hardcodear secrets, actor IDs o taxonomía en componentes UI;
- usar IA donde un parser determinista resuelve el dato.

## Decisión explícita posterior

LLMProvider está requerido por el usuario desde ADR-007 aunque inicialmente Groq sea el único proveedor principal. Encapsular OpenAI existente y conservar su historial. Esta decisión prevalece sobre la recomendación genérica de esperar dos implementaciones para abstraer.
