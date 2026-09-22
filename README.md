# Career Platform — primera entrega local

Motor de oportunidades independiente de Scalix. Women Digital Closer es la primera configuración; evolución en [docs/PLAN.md](docs/PLAN.md).

## Usar

Requiere Node 22+ y Python 3.12. Desde este repositorio:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
npm ci
npm run dev
```

Abre http://127.0.0.1:3100 . El lanzador inicia web, API y worker; Ctrl+C detiene los tres. Se genera un token local nuevo en cada inicio, no hay claves que copiar. `CAREER_PYTHON` permite elegir otro intérprete con las dependencias instaladas.

1. Selecciona perfil, mercado y periodo; comienza con mercados amplios para explorar cobertura.
2. Afina idioma, compensación, fuentes y tratamiento de datos desconocidos.
3. Observa resultados progresivos y avisos por fuente.
4. Abre una oferta para revisar evidencias, condiciones y enlace original.
5. Marca y selecciona ofertas; copia el texto o exporta CSV, XLSX o JSON.
6. Guarda filtros para repetirlos y recupera búsquedas en Historial.

Los datos persisten en `.local/career.sqlite3`. No borres `.local` si quieres conservar el historial. Respaldar con SQLite backup, no copiar únicamente el archivo mientras haya escrituras WAL.

## Alcance real

- Seis conectores públicos: Himalayas, We Work Remotely, Get on Board, Remotive, Remote OK y Arbeitnow; timeout/reintentos y caché según proveedor.
- Capturas inmutables, publicaciones y oportunidades separadas; búsquedas en cola durable con worker explícito.
- Filtros deterministas, puntuación orientativa y avisos de incertidumbre. Sin IA de clasificación aún.
- Idempotencia por fuente/publicación y por petición. Dedupe entre fuentes y revisión de merges pendientes.
- Consultas y relaciones acotadas por organización. La organización activa se configura en servidor con `CAREER_ORG_ID` y `CAREER_ORG_NAME`.
- Conserva atribución y enlaces. Las exportaciones están destinadas a revisión interna; no hay publicación automática a portales de terceros.

Este modo es **solo local y para un operador/equipo en este ordenador**. No ofrece login de alumnas ni debe exponerse a internet. La fase online requiere Supabase Auth/Postgres/RLS y pruebas multiusuario. LinkedIn, Upwork, Facebook y Skool aparecen pendientes de configuración.

No se garantiza un número de ofertas ni que una publicación siga abierta. No se infiere país del idioma, no se transforma presupuesto freelance en sueldo y no se mezclan monedas. El filtro salarial compara exclusivamente campos estructurados en la misma moneda, anual/12 o mensual; confirmar fijo/OTE en la oferta.

## Desarrollo

```sh
npm run contracts
npm run typecheck
.venv/bin/python -m ruff check apps/api scripts/openapi.py tests/test_engine.py
npm test
npm run build
npx playwright install chromium
# Con npm run dev en otra terminal:
npm run test:e2e
```

`packages/contracts/api.d.ts` se genera desde FastAPI; no editar manualmente.
Las pruebas de backend usan una base temporal y respuestas de proveedores controladas; no consultan servicios externos. Las pruebas de navegador usan la app local.

## Continuidad

Leer `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md` y la decisión `docs/decisions/ADR-006-local-first-delivery.md`. Las especificaciones originales completas están en `docs/spec`, incluidas las fases y ADR que antes solo estaban dentro del ZIP.

## Nueva arquitectura aprobada

[MASTER SPEC](docs/spec/00_MASTER_SPEC.md) y [PLAN](docs/PLAN.md) incorporan Groq principal mediante LLMProvider, WDCOpportunity para alumnas y expansión US hispana con [17 fichas](docs/spec/18_US_HISPANIC_SOURCE_RESEARCH.md). Administración conserva toda trazabilidad; la experiencia alumna prioriza empresa, condiciones y siguiente paso.

La implementación local ya incluye Apify guiado y análisis individual OpenAI. Groq, la nueva proyección/portal y las nuevas fuentes siguen pendientes de sus fases: esta actualización es documental y no cambia la app que está en ejecución. Configuración instalada en [INTEGRATIONS](docs/INTEGRATIONS.md).
