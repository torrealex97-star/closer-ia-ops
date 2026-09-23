# ADR-009 — Orquestación de búsqueda cost-aware / quality-aware

Estado: aceptada por petición del usuario, implementación local 2026-09-23. Complementa ADR-008 (catálogo diario) sin sustituirlo; conserva el dominio WDCOpportunity de ADR-007.

## Decisión

El objetivo diario no es un volumen de candidatas brutas ni 50 oportunidades finales. Es **obtener la calidad objetivo al menor coste posible, no obtener el máximo número posible de resultados**. La prioridad operativa es CALIDAD > FRESCURA > DIVERSIDAD > CANTIDAD, con ~10 oportunidades nuevas de alta calidad al día como objetivo suficiente.

Regla de ejecución del Search Orchestrator:

```text
FREE FIRST -> MEASURE QUALITY -> STOP IF GOOD ENOUGH -> ESCALATE ONLY THE GAP
```

1. **SearchGoal configurable**: `daily_high_quality_target`, `minimum_qualified`, `minimum_unique_companies`, `maximum_offer_age_hours`, `minimum_quality_score`, `minimum_application_ratio`, `max_daily_paid_budget`, `prefer_free_sources`. Se persiste por organización (`integration_settings`, provider `search-goal`) y se edita vía API `GET/PUT /v1/search-goal` — cambiar el objetivo no exige tocar código.
2. **Quality Gate determinista**: una oportunidad solo cuenta para el objetivo si no está cerrada explícitamente, su score/100 ≥ `minimum_quality_score`, su fecha publicada/cautiva es ≤ `maximum_offer_age_hours` y tiene siguiente paso claro (application_url/source_url). Frescura desconocida es hueco, no cero: no cuenta como fresca.
3. **Ejecución por capas de coste** (`TIERS = free, low, medium, high, premium`): primero todas las fuentes FREE en paralelo (el coste marginal ~0 no justifica limitarlas); tras cada capa se mide con el Quality Gate y se para si se alcanza el objetivo con la diversidad mínima. La diversidad es señal de riesgo, no cuota: una fuente gratuita que produce 12 excelentes puede cerrar el día sola.
4. **Las fuentes de pago son fallback de gap filling**: solo se escala la capa siguiente si falta calidad, y solo hasta cubrir el gap. Nunca se supera `max_daily_paid_budget` — el presupuesto es margen disponible, no gasto objetivo (ideal diario ≈ 0 €).
5. **Aprendizaje por fuente** (tabla `source_stats`, migración 6): candidatos, cualificadas, alta calidad, coste, yield, duplicados, fallo, coste por cualificada y por alta calidad. `dynamic_priority` ordena por yield−coste−duplicados−fallo para decidir qué consultar antes la próxima vez; una fuente cara con mal yield pierde prioridad y una gratuita con buen yield la gana. El fallo de una fuente nunca detiene la búsqueda (resultados parciales, warning por fuente).
6. **Asignación fuente→tier por configuración** (`integration_settings`, provider `source-tier`): el código no hardcodea precios. Por defecto, feeds/APIs públicos son FREE y las conexiones Apify LOW.
7. **Hermes y Manus no son scrapers generales**: quedan definidos como `AgenticGapFillProvider` de nivel superior al premium: reciben el gap descrito en términos de negocio (p. ej. "faltan 2: closer, español, remoto, España") y buscan de forma específica. Manus queda como deep research excepcional. Sin implementación actual: requisito de diseño, no código entregado.
8. **Dos modos de búsqueda**: Background Discovery (recogida diaria de ADR-008 alimenta el catálogo local) y On-Demand (la búsqueda interactiva consulta el catálogo; no lanza proveedores de pago). La caché de proveedores existente (`provider_cache`) cubre la sincronización de fuentes gratuitas; un SourceCache más rico queda como evolución, no como requisito de esta decisión.

## Implementación real

- `apps/api/career/orchestrator.py`: `SearchGoal`, `gate`, `passes_goal`, `describe_gap`, `source_tiers`, `execute_layered`, `dynamic_priority`, `save_source_stats`.
- `apps/api/career/worker.py`: `execute` pasa por la ejecución por capas cuando hay registry (búsqueda activa); el cierre de run respeta el estado clásico `partial`/`failed`.
- `main.py`: endpoints `GET/PUT /v1/search-goal`.
- `tests/test_orchestrator.py`: 7 pruebas del contrato (FREE≥objetivo no llama a pago; gap de 8/10 escala solo lo necesario; fuente cara con mal yield pierde prioridad; fuente gratuita con buen yield la gana; fallo de fuente no detiene; presupuesto nunca superado; objetivo cambiado 10→3 por API sin tocar código).

## Consecuencias

- Los días con suficiente señal gratuita cuestan 0 € y no ejecutan ninguna capa de pago.
- El número de candidatas brutas deja de ser objetivo: 180→31→14 excelentes puede ser un día completo; 400→17→6 activa la capa siguiente.
- La métrica económica principal es `cost_per_high_quality_opportunity`, con objetivo descendente mes a mes.
- ADR-008 sigue gobernando la recogida diaria y la ventana de 10 días; esta decisión gobierna cuándo se escala a proveedores de pago en búsquedas y lotes.
- Pendiente de implementar (documentado, no entregado): gap query estructural por perfil/mercado/idioma para el AgenticGapFillProvider, reparto dinámico de presupuesto entre capas LOW/MEDIUM y SourceCache unificado.
