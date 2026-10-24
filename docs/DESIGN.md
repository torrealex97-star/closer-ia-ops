# Dirección de interfaz

Persona: coordinadora WDC que prepara una selección para alumnas, revisando encaje y condiciones antes de compartir.
Dominio: mentoría, preparación, selección, oportunidades, evidencia, conexión con empresas.
Color: papel marfil, tinta berenjena, terracota, rosa empolvado y verde salvia para estados.
Firma: mesa de selección con señales de encaje y advertencias de revisión junto a cada oportunidad.
Evitar dashboard de métricas vacías, tarjetas de funcionalidades futuras y puntuaciones presentadas como probabilidades.

Para SearchWorkspace, controles, filas y detalle: foco en buscar/revisar; encabezado editorial serif y controles sans de 14px; proporción lateral 224px y contenido flexible; papel claro con capas ligeramente cálidas y bordes discretos; escala 4px, controles 44px y filas amplias. Selección por checkbox nativo, detalles con dialog nativo. Una sola familia de acento terracota. Estados vacíos reales sin datos ficticios.

## Superficie de alumna — dirección objetivo

Empresa, puesto, condiciones, vigencia y siguiente paso son protagonistas. Mantener identidad editorial WDC y legibilidad; ficha responsive mobile-first. Procedencia secundaria salvo atribución exigida, nunca eliminada del sistema. Unknown explícito, color acompañado de texto, CTA único claro y destino honesto. Admin conserva mesa de selección, fuentes, proveedores, evidencia y costes.

El preview usa WDCOpportunity, no copia del objeto admin. Diseño/estados/copy normativos en [17](spec/17_WDC_OPPORTUNITY_EXPERIENCE.md) y [UI/UX](spec/07_UI_UX.md). No afirmar conexión directa, verificación ni selección que no se haya realizado.

## Sala de práctica

Ocho tarjetas de situación en dos columnas, con etiqueta (`Venta` terracota / `Entrevista` salvia) y **nivel** discreto (suave en salvia, dura en ámbar), titular serif, contexto ficticio explícito y objetivos numerados 01–04. La sala es una conversación de papel: burbujas inset para el interlocutor y rosa empolvado para la alumna, sin avatares inventados (un icono y «Simulación · empresa ficticia»). El cronómetro es discreto y no compite con el título. El **orbe de voz** vive en la cabecera del chat junto a su estado escrito («Voz en espera», «Te escucho», «Pensando», «Hablando»): anillos finos y núcleo con el color del estado (terracota al escuchar, ámbar al pensar, salvia al hablar, gris apagado en reposo), sin animación con `prefers-reduced-motion`. El **dictado** es un botón cuadrado de 44 px pegado al compositor: activo en rosa empolvado, y si el navegador no lo soporta no se muestra; nunca envía solo.

El feedback se lee como una ficha editorial: primero el resumen y una **ficha de puntuación** con la nota grande en serif, la palabra «estimación» debajo y los cuatro ejes en barras finas (salvia ≥70, terracota 40–69, ámbar <40), cada uno con su nota cualitativa y la cita que lo demuestra; después el foco único en rosa empolvado, las dos columnas de siempre, las **señales de estilo** como observaciones citadas, la respuesta modelo con filete salvia y la siguiente práctica. La nota nunca se presenta como oficial ni como probabilidad: el texto lo dice en la ficha y en el pie. En móvil la nota pasa a fila, los ejes a una columna, el compositor ocupa el ancho y las acciones se reparten. Capturas: [situaciones](screenshots/practica-metodo-situaciones.png), [conversación](screenshots/practica-metodo-conversacion.png), [feedback](screenshots/practica-metodo-feedback.png), [señales](screenshots/practica-metodo-senales.png), [móvil](screenshots/practica-metodo-movil.png).

## Radar de oportunidades

Panel de resumen sobre los resultados: disco de anillos con barrido terracota sobre papel, un punto por oferta real (color por perfil, nunca solo color: la leyenda escribe el perfil y su recuento), contador central y tres lecturas verificables (con importe publicado, publicadas en 3 días, perfiles distintos). Barre mientras se espera la respuesta; no simula progreso por fuente ni inventa actividad. La leyenda filtra por perfil. El campo «Pídelo en una frase» declara los filtros que aplica y, si no entiende, no busca. Movimiento limitado por `prefers-reduced-motion`.
