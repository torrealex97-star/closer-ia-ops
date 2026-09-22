# P01B_OPPORTUNITY_DOMAIN — Modelo de oportunidad y relaciones

Estado: planificada, no implementada por esta actualización documental.

## Dependencias y alcance

Después de P05A; antes de proyección y preview.
Migraciones aditivas para opportunities/versions/verifications, elegibilidad separada y relaciones de 03_DATA_MODEL. Contratos Pydantic admin/student, connection_type y application_type. Backfill conservador draft/verifying; evidencias y contactos privados.

## Verificación

Migrar copia de DB real local, raw sin cambios, restricciones/FKs por org, versionado concurrente y DTO allowlist. Direct_company no se infiere de dominio.

## Aceptación

Todo job conserva posting/raw; no empresas/fechas/partnerships inventados; tipos generados desde OpenAPI al implementar; rollback operativo por backup, no reescritura de migraciones.

Referencias: [MASTER SPEC](../00_MASTER_SPEC.md), [plan vigente](../../PLAN.md), [estado real](../../STATUS.md). Registrar archivos, migraciones, contratos, tests, costes y limitaciones al terminar. No declarar verde un canary sin haberlo ejecutado.
