---
name: dashboard-design
description: "Reglas de diseño y gráficas para TODOS los dashboards y tablas del panel de Career Platform (métricas, fuentes, alumnas, revisión). Usar SIEMPRE antes de crear o cambiar un dashboard, tarjeta de KPI, gráfico, tabla o estado vacío. Use before building or changing any dashboard, chart, KPI or data table in apps/web."
---

# Diseño de dashboards (Career Platform)

Complementa `data-visualization-pro` (teoría: qué gráfico, percepción, color) con lo **específico de este repo**. Si chocan, manda este documento y `docs/DESIGN.md`.

## 0. Antes de empezar
1. Lee `docs/DESIGN.md` y los tokens de `apps/web/app/globals.css`. **Cero colores hex fuera de `:root`** (hoy hay 0; se comprueba con `node scripts/check-design.mjs`).
2. Reutiliza lo que ya existe: `stat-strip` (KPIs), `data-table`/`table-wrap`, `status ok|bad`, `card-meta`, `empty`, `search-panel`, `role="progressbar"` (gasto Apify). Orden: REUSE → EXTEND → EXTRACT → CREATE.
3. Pregúntate qué decisión toma la persona con este panel. Si no hay decisión, no es un dashboard: es relleno ("evitar dashboard de métricas vacías", DESIGN.md).

## 1. Honestidad de los datos (lo primero, por encima de lo estético)
- **Un hueco no es un cero.** "Fuente caída", "sin configurar" y "0 filas" se pintan distinto. Sin dato: **«—»** y la causa ("no se mide", "sin clave"). Ejemplos ya hechos: coste por oferta buena = «—», minutos de revisión = «no se miden».
- **Un error de carga no es un estado vacío:** mensaje visible + reintentar; nunca sumas parciales con aire de totales.
- Toda cifra dice **unidad, periodo y fuente** (p. ej. «últimos 14 días»). Definiciones de métricas en un solo sitio (`lib/metrics.ts`); la UI no las redefine.
- Nada inventado para llenar: ni series, ni "tendencias", ni puntuaciones presentadas como probabilidades.
- Distingue lo medido de lo estimado ("estimación", "heurístico sin calibrar").

## 2. Elegir el gráfico (decisiones ya tomadas para este panel)
| Pregunta | Usar | Evitar |
| --- | --- | --- |
| Evolución diaria (ofertas buenas/día) | Barras verticales con base en 0 (≤ 31 barras) o línea | Áreas apiladas sin necesidad |
| Comparar fuentes/niveles | **Tabla ordenada** con barra en celda; barras horizontales | Tarta con > 5 porciones; 3D |
| Parte del total (niveles de fuente) | Texto con % o barra apilada de ≤ 5 tramos (top-4 + «Otras») | Anillos con muchas porciones |
| Estado de un proceso (cola, presupuesto) | `progressbar` con valor y etiqueta | Colores sin texto |
| Ranking de ofertas | Tabla (es un listado, no un gráfico) | Gráficos decorativos |
Reglas: eje en 0 para barras; ejes truncados solo si se indica; etiquetado directo antes que leyenda; ≤ 1-3 llamadas de atención por gráfico; titula con la conclusión cuando exista ("Esta semana: 12 ofertas buenas") y deja el dato debajo.

## 3. Color y contraste (calculado con los tokens reales, WCAG 2.x)
| Texto | sobre `paper` | sobre `inset` | Veredicto |
| --- | --- | --- | --- |
| `ink` | 12,7 | 11,9 | Texto principal |
| `secondary` | 4,88 | 4,56 | Texto secundario (mínimo para < 14 px) |
| `accent` | 6,44 | 6,02 | Enlaces, énfasis |
| `sage` | 5,12 | 4,78 | Estado correcto |
| `warning` | 5,26 | 4,91 | Aviso |
| **`muted`** | **3,40** | **3,18** | **NO cumple AA para texto**: solo decoración, iconos o texto ≥ 18 px/bold ≥ 14 px (3:1) |
- **Hallazgo abierto:** `--muted` se usa en texto de 8-11 px (`workspace-label`, `source-caption`, `score small`, `footnote`…). No cumple AA. Propuesta: usar `--secondary` para todo texto < 14 px (decisión de diseño del dueño; no cambiado aún).
- `accent` y `sage` tienen contraste mutuo de solo **1,26**: no se distinguen por luminosidad (ni con daltonismo). **Nunca** diferenciar dos series solo por esos colores: añade etiqueta, forma o patrón.
- El color nunca es la única codificación: los estados llevan texto (`Activa`, `Pausada`, `Cola humana`).
- Marcas gráficas (barras, iconos) ≥ 3:1 contra su fondo (`accent` 6,44 y `sage` 5,12 cumplen).
- Series: una sola serie = `accent`; comparación de dos = `accent` + `ink` (alto contraste mutuo), no `accent` + `sage`.

## 4. Accesibilidad y responsive
- Todo gráfico no trivial tiene **alternativa textual o tabla**: `<table>` visible/plegable, o `role="img"` con `aria-label` que resuma lo esencial. Los KPIs son texto, no imágenes.
- Tablas: `<th scope>`, cabeceras claras, números alineados a la derecha (`num`), sin scroll horizontal en móvil dentro de la página (el contenedor `table-wrap` puede desplazarse).
- Foco visible, objetivos táctiles ≥ 40 px (el repo ya usa 40), `prefers-reduced-motion` respetado (ya global). Animaciones ≤ 280 ms y solo para orientar un cambio; sin animaciones infinitas.
- Verifica 390 px de ancho: `document.documentElement.scrollWidth <= innerWidth` (ya está en `tests/admin-auth/ui.mjs`).

## 5. Técnica
- Hoy los gráficos son HTML/CSS/SVG propios (sin librería). **No añadir una librería de gráficos** salvo necesidad demostrada (más de 3 tipos de gráfico reales); si se añade (p. ej. Recharts): colores por variable CSS (`var(--accent)`), versión fijada, y una sola librería.
- SVG < 1.000 elementos; si hay más, agrega en el servidor (paginación y agregados en PostgreSQL, no en el navegador).
- Formatos: números con `Intl.NumberFormat('es')`; fechas `Intl.DateTimeFormat('es')`; euros con símbolo. No `toLocaleString` suelto repetido: centralizar al repetir.
- Estados de cada panel: **cargando, vacío (con el siguiente paso), error (con reintentar), parcial (qué falta)**. Los cuatro, siempre.
- Todo dato personal de alumnas queda fuera de gráficos e informes agregados con n pequeño.

## 6. Antes de dar un dashboard por terminado
1. `node scripts/check-design.mjs` (sin hex fuera de `:root`).
2. Typecheck y build; prueba de interfaz que abra el panel y compruebe su contenido real (no solo que compile: un gráfico puede no montarse por datos condicionales).
3. Comprobación visual a 1280 px y 390 px; revisar estados vacío/error/parcial con datos simulados.
4. Contraste de cualquier color nuevo contra `paper`, `sheet` e `inset` (≥ 4,5 texto, ≥ 3 marcas).
5. Anota en `docs/STATUS.md` qué se probó (simulado) y qué se verificó (real).

## 7. Qué NO hacer
Tartas > 5 porciones · 3D · eje truncado sin avisar · rainbow · semáforo rojo/verde sin texto · tarjetas de funcionalidades futuras · números sin periodo · mezclar «sin dato» con 0 · decorar con datos inventados · copiar el estilo oscuro/Recharts de otros proyectos (aquí la dirección es papel y tinta, `docs/DESIGN.md`).
