# ADR-004: Supabase Queues + explicit worker

Status: Accepted

## Decision
Usar Supabase Queues/pgmq para tareas durables del MVP y un proceso worker que hace pull.

## Why
Volumen pequeño/medio, menor infraestructura y persistencia suficiente.

## Consequences
No asumir que la cola ejecuta tareas por sí sola. Diseñar visibility timeout, ack/archive y retries.
