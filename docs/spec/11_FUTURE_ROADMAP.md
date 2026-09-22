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

## Orden revisado de evolución

Antes del portal: P05A Groq/LLMProvider; P01B proyección/modelo y relaciones; P04K fuentes US en lotes pequeños; P05B normalización/verificación/WDCOpportunity; P06B preview de alumna en admin. Después acceso multiusuario seguro y portal. Preparar entidades no autoriza envíos ni crea relaciones ficticias.

La primera experiencia de alumna mostrará empresa, oportunidad, condiciones y siguiente paso; trazabilidad técnica queda admin-only con atribución preservada. Matching combina requisitos/preferencias/competencias y evidencia, no reutiliza ciegamente el score de búsqueda como probabilidad personal.

Evolución de conexiones: descubrimiento público → empresa/recruiter verificados → necesidad directa → selección de candidatas consentida → referral → introducción confirmada. P11_DIRECT_CONNECTIONS define criterios. companies, company_partnerships, recruiters, company_contacts, direct_opportunities, candidate_referrals e introductions evitan reconstruir adquisición.

Groq también será default detrás de LLMProvider para futuros roleplays/entrevistas, con contratos y evaluación propios. Autoapply sigue separado de búsqueda y exige autorización/confirmación; no se activa por este cambio documental.
