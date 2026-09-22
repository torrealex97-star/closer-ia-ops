# ADR-001: Monorepo

Status: Accepted

## Decision
Un repositorio con web, API, worker, connectors, publishers, migrations y contratos.

## Why
Cambios del schema/search atraviesan varias capas y deben versionarse juntos.

## Consequences
CI debe poder ejecutar suites por path; deploys siguen siendo independientes.
