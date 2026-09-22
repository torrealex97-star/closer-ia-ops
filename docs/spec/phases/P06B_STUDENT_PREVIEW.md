# P06B_STUDENT_PREVIEW — Preview de alumna y contratos separados

Estado: planificada, no implementada por esta actualización documental.

## Dependencias y alcance

Después de P05B; dentro de administración local primero, portal después de Auth/RLS.
Ficha empresa/puesto/condiciones/acción, actividad/fecha clara, atribución secundaria según política; destinos externos honestos; preview usa StudentOpportunity allowlist y mismo renderer de publicación.

## Verificación

Seis connection_type; tres estados; unknown empresa/fecha/salario; teclado/móvil; ninguna fuga admin en DTO; destino y disabled_reason correctos.

## Aceptación

Operadora revisa ficha sin configurar proveedores; alumna entiende siguiente paso. No exponer local mode públicamente ni afirmar login implementado.

Referencias: [MASTER SPEC](../00_MASTER_SPEC.md), [plan vigente](../../PLAN.md), [estado real](../../STATUS.md). Registrar archivos, migraciones, contratos, tests, costes y limitaciones al terminar. No declarar verde un canary sin haberlo ejecutado.
