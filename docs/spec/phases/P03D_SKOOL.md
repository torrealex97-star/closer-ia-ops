# Phase 03D — Skool

## Goal
Extraer oportunidades de comunidades Skool cubiertas por proveedores configurados.

## Config per community
```text
name
slug/url
market_hint
language_hint
priority
active
provider_override?
```

## Source query
Cuando provider soporta search:
- role aliases;
- recent window.

Cuando solo soporta feed:
- traer recent posts limitados;
- clasificar downstream.

## Raw
Conservar:
- post id/url;
- title;
- body;
- author label si viene en provider output;
- created_at;
- group slug/url;
- raw payload.

## Member-only
Capacidad separada:
`authenticated_private_data`.

Nunca hacer que credenciales personales sean requisito implícito del source.

## Acceptance
Al menos una community configurada ejecuta un run reproducible, produce raw items y pasa contract fixtures.

## Actualización normativa — ADR-007

Registrar cada comunidad pública y su ruta verificada; hints de mercado/idioma no son requisitos factuales. CTA de proceso real y relación desconocida, sin inventar empresa.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
