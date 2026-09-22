# Phase 03C — Facebook Groups

## Goal
Extraer oportunidades desde grupos públicos relevantes sin que la cuenta personal del operador sea una dependencia.

## Modes

### Known groups
Input: URLs/IDs configurados.
Fetch: recent posts.
Filter: downstream job-offer classifier.

### Public discovery
Activar solo si provider lo soporta y se valida en canary.

## Config per group
```text
name
url
market_hint
language_hint
priority
active
max_posts
```

Hints ayudan a query/ranking; nunca sustituyen datos explícitos del post.

## Raw
Guardar texto/post URL/timestamp/provider payload.

## Classification
Posts promocionales, solicitudes de empleo o discusiones se rechazan.

## Private/member-only
No se asume acceso anónimo. Cualquier capacidad autenticada futura vive en un provider separado y explícito.

## Acceptance
Grupos conocidos producen posts recientes; errores de un grupo no cancelan otros; cada oferta conserva permalink.

## Actualización normativa — ADR-007

Discovery de comunidades públicas US hispanas por URL concreta validada. No miembros/contactos privados; clasificar promociones/no-empleo; community_opportunity hasta prueba de relación.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
