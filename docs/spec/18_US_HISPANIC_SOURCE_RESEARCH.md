# Expansión US: ventas hispanas e internacionales

Investigación: 2026-09-22. Incorporación al catálogo documental y al roadmap, no activación de conectores. Las prioridades son una recomendación de ingeniería pendiente de medir yield, no afirmaciones de volumen disponible.

## Hallazgos

LatPro redirige a DiversityJobs Hispanic/Latinx: usar un source con alias, evitando duplicarlo. [Referencia](https://www.latpro.com/).
HispanicPro enlaza su bolsa a Hispanic-Jobs.com: comunidad y board necesitan dedupe, no dos extracciones del mismo listado. [Referencia](https://hispanicpro.com/).
HireLATAM exige residencia LATAM e inglés; no es apto por defecto para residentes de España ni para quien solo hable español. [Referencia](https://hirelatam.com/jobs/).
Las APIs públicas por empresa de Greenhouse, Lever y Ashby son rutas concretas de bajo coste de adquisición; la selección de empresas y la elegibilidad siguen pendientes de validar. Ver fichas con documentación oficial.

## Prioridades y fichas

P0 = primer spike por accesibilidad y encaje esperado; P1 = ampliar cobertura tras medición; P2 = exploratoria o acceso no confirmado.

| Fuente | Familia | Prioridad | Ficha |
|---|---|---|---|
| iHispano | job_board | P1 | [ihispano](sources/IHISPANO.md) |
| LatPro / DiversityJobs Hispanic-Latinx | job_board | P1 | [latpro_diversityjobs](sources/LATPRO_DIVERSITYJOBS.md) |
| Hispanic-Jobs.com | bilingual_job_board | P1 | [hispanic_jobs](sources/HISPANIC_JOBS.md) |
| HLPA Job Board | association_job_board | P2 | [hlpa](sources/HLPA.md) |
| HispanicPro | public_community | P2 | [hispanicpro](sources/HISPANICPRO.md) |
| Latinas in Tech | professional_community | P2 | [latinas_in_tech](sources/LATINAS_IN_TECH.md) |
| HireLATAM | recruiting | P0 | [hirelatam](sources/HIRELATAM.md) |
| Hire With Near | recruiting | P0 | [hire_with_near](sources/HIRE_WITH_NEAR.md) |
| Remote Latinos | recruiting | P0 | [remote_latinos](sources/REMOTE_LATINOS.md) |
| Somewhere | recruiting | P1 | [somewhere](sources/SOMEWHERE.md) |
| SalesJobs.com | sales_job_board | P2 | [salesjobs](sources/SALESJOBS.md) |
| RepVue | sales_job_board | P2 | [repvue](sources/REPVUE.md) |
| Working Nomads | remote_job_board | P1 | [workingnomads](sources/WORKINGNOMADS.md) |
| Wellfound | startup_job_board | P1 | [wellfound](sources/WELLFOUND.md) |
| Greenhouse Job Board | company_ats | P0 | [greenhouse](sources/GREENHOUSE.md) |
| Lever Postings | company_ats | P0 | [lever](sources/LEVER.md) |
| Ashby Job Postings | company_ats | P0 | [ashby](sources/ASHBY.md) |

No API confirmada significa precisamente eso; no se inventan endpoints ni IDs de Actors. Un enlace accesible no prueba permiso de redistribución, vigencia ni cobertura española.

## Aprovechar fuentes existentes

Mantener Himalayas, WWR, Remotive y Remote OK para ventas US/global en ES/EN, conservando atribución. Extender P03A LinkedIn y búsquedas Indeed por proveedor con términos hispanos; verificar la ruta sin sesión del operador. No crear otro conector solo por country=US.

Marketplaces: Upwork, Freelancer, Workana, PeoplePerHour y Guru conservan sus fases; añadir queries ES/EN, client_country=US como señal de mercado, y requisitos de país del trabajador aparte. CommissionCrowd y RepVue conservan P04G. Ninguna tarifa de proyecto se presenta como sueldo mensual.

Comunidades: HispanicPro y Latinas in Tech tienen fichas; Facebook/Skool/Telegram/Reddit/Discord quedan como superficies por URL pública concreta, no promesa de búsqueda universal. No se ha validado en esta investigación una lista de grupos públicos US hispanos con yield demostrable. Backlog: descubrir y registrar URLs, fecha, anunciante, visibilidad, términos y coste antes de activar. Eventos, cursos, perfiles buscando trabajo y publicidad quedan excluidos.

## Queries versionadas

Roles: Closer, High-Ticket Closer, Appointment Setter, DM Setter, SDR, BDR, Account Executive, Sales Representative, Inside Sales, Business Development, Enrollment Advisor, Sales Consultant, Cold Caller, Lead Generation, Telemarketing, Comercial, Ejecutivo Comercial y Asesor Comercial.

Suite obligatoria:
```text
Spanish speaking sales
Spanish sales representative
Bilingual sales
Remote Spanish closer
Spanish appointment setter
Latino sales
Hispanic market sales
Spanish SDR
Spanish BDR
Bilingual account executive
Enrollment advisor Spanish
High-ticket closer Spanish
Ventas remotas
Closer de ventas
Setter de citas
Ejecutivo comercial remoto
```

Expandir por alias y capacidades, no concatenar todos como AND. Máximo inicial 3 consultas por fuente/run, alternadas según recall y caché; dedupe antes de pedir detalles. Los conectores sin keyword search filtran localmente un feed cacheado.

## Filtros que no se pueden confundir

employer_country, customer_market, allowed_worker_countries, excluded_worker_countries, residency_required, work_authorization, language_requirements, timezone_overlap y remote_mode tienen evidencia separada.

“US remote only” se rechaza para ES/LATAM si la restricción es explícita. “Bilingual” sin idiomas no demuestra español. Empresa latina o cliente hispano no demuestra idioma obligatorio; es señal de descubrimiento. Oferta LATAM en inglés puede ir a búsqueda bilingüe/internacional opt-in si la alumna cumple inglés; no entra silenciosamente en “Español requerido”. Mantener desconocidos como revisión y nunca relajar requisitos para alcanzar cupo.

Híbrido requiere residencia compatible con oficina; no presentar una oferta híbrida en Miami como trabajo online desde Madrid.

## Rollout y medición

1. Registro pequeño de tenants ATS + Remote Latinos/HireLATAM/Near.
2. Hispanic-Jobs, iHispano, DiversityJobs y Working Nomads.
3. Somewhere/Wellfound según spike, luego fuentes P2 y comunidades públicas verificadas.

Medir por source/provider: recuperados, relevantes, con español explícito, elegibles ES/LATAM, US-only, desconocidos, activos verificados, duplicados, errores, tiempo y coste por oportunidad útil. Evaluar un muestreo en varios días; no activar los 17 candidatos por cada búsqueda. Fallback manual por URL conserva el mismo pipeline.
