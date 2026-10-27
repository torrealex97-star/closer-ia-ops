---
agent: codebuff
status: validated
branch: main
touches: sites/engine/worker.js, tests/engine/terms.mjs, docs/EXTERNAL_SOURCES.md, docs/STATUS.md
date: 2026-10-26
---
`himalayas-closer` (búsqueda de closer por término, ya en el motor desde la sesión 116) **no recogía en producción**: el presupuesto por invocación contaba solo los `fetch`, no el gasto D1 que comparte el techo del Worker, y las dos búsquedas de closer de LATAM/Himalayas y el ATS morían con «Too many subrequests». `planRun` reserva ahora un colchón de D1 (16 `fetch` por pasada), aplaza lo que no cabe declarándolo y abre la pasada siguiente por lo aplazado o caído. Primer día medido en producción: Himalayas 18 ofertas (2 closers) y FreeHire LATAM closer 55; con el vocabulario completo, 42 ofertas y 26 closers, todos en inglés (solo visibles con el opt-in bilingüe de la alumna). Motor desplegado (preview y producción `22:27Z`, `succeeded`) y `terms.mjs` 11/11.

Aviso para el dueño: las dos recogidas forzadas para medir agotaron la cuota **mensual de escrituras D1** del motor (100.604/100.000) y el sitio está **en pausa (HTTP 429)** hasta el reinicio del 1 de noviembre, salvo que se pase a plan de pago. La web no cae: sirve las externas aprobadas y declara `degraded: 'motor'`.
