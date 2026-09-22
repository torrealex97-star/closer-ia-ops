# UI / UX

## Principio

La interfaz principal debe responder a:

> “¿Qué estoy buscando, qué fuentes están trabajando y qué oportunidades utilizables tengo ya?”

## 1. Search Builder

Ruta: `/search`

Campos:
- rol;
- keyword;
- país/ubicación;
- remote;
- idioma;
- experiencia;
- compensación;
- antigüedad;
- fuentes;
- target results.

Controles avanzados colapsados:
- include/exclude;
- strict/prefer salary;
- per-source limits.

CTA principal:
`Buscar oportunidades`.

## 2. Live Search Run

Ruta: `/runs/{id}`

Header:

```text
Closer · España · Remote · >= 2.000 EUR
Running · 01:18
157 candidatos · 24 oportunidades
```

Source status:

```text
LinkedIn      ✓ 48
Skool         ✓ 22
Facebook      … 31
Upwork        ✓ 37
Freelancer    ⚠ timeout -> fallback
ATS           ✓ 19
```

Un fallo muestra warning, no pantalla roja global.

## 3. Results table

Columnas:

```text
select
score
role/title
company/client
location
remote
compensation
source(s)
published
status
actions
```

Filtros locales no relanzan sources; filtran el resultado ya producido.

## 4. Job detail

Mostrar:

- título;
- empresa/cliente;
- match explanation;
- resumen;
- descripción;
- requisitos;
- compensación;
- apply;
- sources;
- provenance;
- discovered/posted/last checked.

Acciones:

```text
Copy
Open original
Export
Publish
Mark invalid
Mark duplicate
Edit
```

## 5. Saved searches

Ruta `/saved-searches`.

```text
Closers ES Remote
Last run: today 09:00
25 new
Schedule: every 6h
[Run now]
```

## 6. Sources health

Ruta `/sources`.

```text
Source     Provider        Health     p95     Last success
LinkedIn   provider-a      healthy    31s     2m
LinkedIn   provider-b      standby    -       -
Skool      provider-a      healthy    44s     5m
```

## 7. Publication

Preview antes de enviar.

Bulk select + destination + template.

## UX states obligatorios

- empty before search;
- queued;
- partial results;
- source degraded;
- no results;
- completed;
- cancelled;
- global failed;
- export generating;
- publication pending/success/error.

## Responsive

Desktop-first interno.
Tablet usable.
Mobile no es prioridad MVP.
