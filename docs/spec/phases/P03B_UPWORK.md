# Phase 03B — Upwork

## Goal
Integrar búsqueda de proyectos freelance públicos relevantes para Sales.

## Scope
- source `upwork`;
- hosted provider A;
- fallback provider config;
- keyword/budget/experience/date query mapping.

## Normalize
Mapear:
- project id;
- title;
- description;
- fixed/hourly;
- budget/rate;
- skills;
- experience;
- client location si pública;
- published_at;
- direct URL.

`employment_type=freelance_project`.

## Salary/budget
No convertir un presupuesto fixed de proyecto en salario mensual.

Usar compensation metadata y permitir ranking específico sin falsear period.

## Acceptance
Búsqueda de sales/closer devuelve candidatos recientes y no contamina el modelo salarial de empleo tradicional.
