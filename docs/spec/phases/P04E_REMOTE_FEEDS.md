# Phase 04E — Low-Maintenance Remote Feeds

## Goal

Añadir fuentes remotas con interfaces oficiales de bajo mantenimiento.

## Sources

```text
weworkremotely
remoteok
remotive
```

---

# 1. We Work Remotely

## Access

RSS público oficial, incluyendo categoría:

```text
Sales and Marketing
```

## Provider

```text
source_code = weworkremotely
provider = official_rss
```

## Advantages

- RSS estable;
- no browser automation;
- ventas y marketing separados;
- remote/global;
- publicaciones con salario en algunos casos.

## Mapping

```text
title
company
published_at
location
salary_text
employment_type
source_url
description
```

---

# 2. Remote OK

## Access

Remote OK documenta públicamente:

```text
JSON feed
RSS feed
```

sin autenticación.

## Provider

Preferir JSON para parsing estructurado.

```text
source_code = remoteok
provider = official_json
```

## Filters

Filtrar localmente por tags/title/description:
- sales;
- SDR;
- account executive;
- business development;
- closer;
- appointment setter.

---

# 3. Remotive

## Access

Public Jobs API + RSS.

## Important

La API pública:
- puede tener retraso de aproximadamente 24h;
- exige atribución y link back;
- incluye restricciones de redistribución.

Por eso:

```text
source_code = remotive
distribution_policy = attributed_only
```

y no permitir que el publish engine republíque esta fuente a destinos prohibidos/configurados sin pasar por `SourceDistributionPolicy`.

## Domain addition

Añadir a source config:

```text
redistribution_policy
requires_attribution
attribution_text
allowed_publish_targets[]
blocked_publish_targets[]
```

Esto evita que la lógica de publicación ignore condiciones de cada feed.

## Acceptance

- [ ] WWR RSS operativo;
- [ ] RemoteOK JSON operativo;
- [ ] Remotive API/RSS operativo;
- [ ] source-specific attribution persisted;
- [ ] publish engine consulta distribution policy;
- [ ] una caída individual no afecta el resto;
- [ ] fixtures para XML/JSON.

## Research references

- https://weworkremotely.com/remote-job-rss-feed
- https://remoteok.com/faq
- https://remotive.com/remote-jobs/api

## Actualización normativa — ADR-007

Añadir suite US Spanish/bilingual manteniendo políticas de redistribución. No retirar atribución para centrar empresa; feed reciente no demuestra vacante activa.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
