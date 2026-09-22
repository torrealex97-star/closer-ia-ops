# Future Roadmap

## Post-MVP 1 — Student portal

Añadir:
- students;
- preferences;
- feeds;
- saved jobs;
- notifications.

Matching usa el mismo motor de scoring con pesos por estudiante.

## Post-MVP 2 — CRM

Webhook:
`student.created/updated/status_changed`.

No crear passwords desde CRM.
Usar invitación/Auth.

## Post-MVP 3 — Application tracking

```text
saved
applied
interview
offer
rejected
hired
```

Métrica objetivo:
`source -> job -> application -> interview -> hire`.

## Post-MVP 4 — Autoapply

Servicio separado del search engine.

Nueva interface:

```text
ApplicationAdapter
  validate_profile()
  prepare_application()
  submit()
  verify_submission()
```

Requisitos antes de construir:
- perfil/cv;
- respuestas configurables;
- revisión humana;
- audit log;
- source-specific permissions;
- dedupe de applications;
- rate controls.

No incluir lógica de autoapply dentro de connectors de búsqueda.

## Post-MVP 5 — Outcome-driven ranking

Con suficientes datos:
- entrevistas;
- ofertas;
- contrataciones.

Ajustar `source_quality_score` y ranking sin perder explicabilidad.

## Post-MVP 6 — Browser extension

Fallback/captura manual:
- URL;
- visible text;
- source;
- selected section.

No es dependencia del buscador automático.
