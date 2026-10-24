# Relevo entre agentes: cómo funciona

Varios agentes (sesiones de Claude, Codex u otros) y una persona (el dueño) trabajan sobre este repo. Para no pisarse ni perder contexto:

1. **Una ficha por trabajo vivo** en `docs/handoff/claims/<agente>-<tema>.md`. Una ficha por fichero evita los conflictos de merge que provoca un único documento compartido (Growth Ops tuvo un handoff de 4.300 líneas y colisiones al fusionar varias PRs sobre la misma ancla).
2. **Excepción:** `docs/STATUS.md` es de solo añadir (cada PR antepone su entrada); no cuenta como solape y su conflicto se resuelve al fusionar conservando ambas entradas.
3. **Antes de empezar:** `node scripts/handoff.mjs list`. Si lo que vas a tocar (`touches`) aparece en otra ficha, **no lo toques**: coordina con el dueño o espera.
3. **Al empezar:** crea tu ficha (`status: in_progress`), commit en tu rama. `node scripts/handoff.mjs check` debe pasar.
4. **Al terminar y subir la PR:** `status: validated` + `pr: N` (a la espera de revisión del dueño). Si te bloqueas: `status: blocked` y la causa en el texto.
5. **Al fusionarse la PR:** **borra la ficha** y añade una línea a `docs/handoff/archive/AAAA-MM.md` (resultado y PR). Las fichas vivas son solo lo que sigue abierto.
6. **Un trabajo `in_progress` por agente.** Varios `validated` esperando revisión sí se permiten. Las pilas de ramas se declaran con `depends_on`.
7. **`docs/ACTIVE_HANDOFF.md` se mantiene corto (≤ ~150 líneas):** estado, tareas del dueño, decisiones pendientes y siguiente acción exacta. El histórico va al archivo, no al documento vivo.

## Plantilla de ficha

```
---
agent: <nombre-del-agente>
status: in_progress | validated | blocked
branch: feat/<tema>
pr: <número, cuando exista>
touches: <ficheros, carpetas/ o table:nombre separados por comas>
date: AAAA-MM-DD
depends_on: <ficha de la que depende, si la hay>
---
Qué se hace y qué NO. Bloqueos y siguiente acción exacta.
```

## Reglas aprendidas (de Growth Ops, adaptadas)

- **Fusión de PRs propias: permitida** (autorización permanente del dueño, 2026-10-18) con CI verde en el head, sin conflictos ni hallazgos rojos abiertos y con merge commit; excepciones que exigen orden expresa en `AGENTS.md`.
- **Nada huérfano.** Tests, mocks, notas de STATUS y documentos viajan en la misma rama que el código que describen; no se cierra una sesión con trabajo sin subir (`git status` limpio y rama con push). `tests/orphan-refs.mjs` (lo ejecuta `run.sh`, y por tanto el CI) falla con un mensaje legible si una prueba llama a una ruta `/api` o a un fichero de prueba que no existe. Origen: el 24-oct-2026 `main` estuvo en rojo varios pushes porque se subieron los tests y las notas de la actividad de alumnas sin su código.
- **Sin merge-base no hay merge.** Antes de fusionar o continuar una rama ajena: `git merge-base main <rama>` debe devolver un commit. Si no, extrae el contenido único, relévalo en una rama nueva desde `main` y cierra la PR como sustituida.
- **Nunca borres ni reemplaces trabajo no fusionado de otro agente.** Lee su diff y su ficha primero.
- **Una migración aplicada en producción se versiona en el repo en la misma PR** (`supabase/migrations/`). Aplicar sin versionar deja el historial desalineado.
- **El checkout puede cambiar bajo tus pies** si hay más de una sesión sobre el mismo directorio: comprueba `git status` antes de editar, `git add` con rutas acotadas (nunca `-A` sin mirar), y re-verifica tu cambio antes de validar.
- **Un run de CI "cancelled" no es un fallo** (cada push cancela el anterior): diagnostica por el último SHA.
- **Cierre de sesión:** deja el repo en uno de dos estados. *Validado:* push + PR + ficha `validated`. *No validado/bloqueado:* push a tu única rama en curso + ficha `blocked` con el motivo y la siguiente acción exacta. Nunca fusiones código dudoso solo por cerrar la sesión.
- **Estado seguro de relevo** (plantilla de Growth Ops, útil al agotar contexto): rama y base · qué está aplicado y verificado · hallazgos y bloqueos · siguiente secuencia exacta · ficheros de lectura obligatoria · "no declarar PASS en X" (lo que sigue sin probar).
