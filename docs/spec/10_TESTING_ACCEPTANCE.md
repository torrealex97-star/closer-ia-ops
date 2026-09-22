# Testing and MVP Acceptance

## Pirámide

### Unit
- query normalization;
- taxonomy;
- source query builders;
- parsers;
- scores;
- dedupe features;
- template renderer.

### Contract tests
Por connector/provider con fixtures reales anonimizados y schema assertions.

### Integration
- DB migrations;
- queue -> worker;
- provider callback -> raw -> posting -> job;
- search partial;
- publication idempotency.

### E2E
- create search;
- progressive results;
- filter/select;
- export;
- publish preview;
- publish;
- saved search run.

## Golden dataset

Mínimo 200 items manualmente etiquetados.

Debe incluir:
- puestos obvios;
- ofertas sin palabra “closer” pero equivalentes;
- no-empleo/promoción;
- duplicados cross-source;
- distintos idiomas;
- salary ambiguo;
- remote scope ambiguo;
- social posts cortos.

## Quality gates

### Classification
- precision >= 90%;
- recall >= 85%.

### Dedupe
- precision de merge >= 95%;
- false merge < 1%.

### Traceability
- 100% jobs tienen al menos un posting;
- 100% postings tienen raw/source/provider.

### Search reliability
Con una fuente forzada a timeout:
- run termina `partial`;
- resultados de otras fuentes están disponibles;
- warning identifica fuente.

### Performance
- API create run p95 < 1 s sin contar ejecución externa;
- first useful results p95 <= 60 s para fuentes rápidas;
- complete p95 <= 5 min excluyendo providers `degraded`;
- UI no bloquea mientras corre.

### Export
- export contiene solo selected jobs;
- unicode correcto;
- URLs preservadas;
- XLSX abre sin reparación.

### Publication
- preview y send comparten renderer;
- retry con misma idempotency key no duplica.

## Acceptance scenario principal

Query:

```text
Closer
España
Remote
Spanish
posted <= 72h
salary >= 2k/month prefer
critical sources enabled
target candidates = 200
target results = 30
```

Se revisa manualmente:
- relevancia;
- duplicados;
- freshness;
- apply path;
- source provenance.

## Definition of Done del MVP

MVP se considera listo cuando:

1. operador puede lanzar búsquedas sin tocar código;
2. fuentes críticas operan mediante connector registry;
3. al menos un fallback está probado para una fuente crítica;
4. un fallo individual produce partial success;
5. resultados están normalizados/deduplicados;
6. puede exportar y publicar;
7. saved search puede ejecutarse manualmente y programada;
8. gold set alcanza gates;
9. métricas por provider visibles;
10. runbook permite diagnosticar source failures.
