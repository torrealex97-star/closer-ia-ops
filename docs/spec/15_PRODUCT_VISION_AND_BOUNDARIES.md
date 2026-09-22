# Visión de producto y límites — 2026-09-22

## Contexto confirmado por el usuario

- Este producto es independiente de Scalix Systems; no combinar sus aplicaciones.
- La primera empresa usuaria es Women Digital Closer (WDC): https://womendigitalclosers.com/ . Forma closers de ventas y las conecta con empresas.
- El buscador de oportunidades es el punto de partida. La evolución puede incluir acceso individual de alumnas, preparación mediante roleplays con IA, entrenamiento de entrevistas y candidatura automática a ofertas.
- Puede haber varias aplicaciones para WDC o ampliarse esta misma. Esa elección aún no está cerrada.
- El código debe poder reutilizarse para otras empresas que preparen personas para otros puestos online, incluyendo búsqueda de oportunidades para esos perfiles.
- El descubrimiento de colaboradoras/influencers en Instagram, TikTok, YouTube y LinkedIn es otro producto. El usuario prevé ubicarlo en el repositorio de Scalix Systems, separado de la aplicación Scalix. No se implementa como parte de este motor de empleo.

## Recomendación arquitectónica pendiente de materializar

Crear un repositorio independiente para la plataforma de preparación y empleabilidad, con nombre técnico neutral. WDC es la primera configuración de empresa, no una condición fija en el código.

Empezar con una aplicación modular y el motor de oportunidades ya especificado. El monorepo puede alojar otras aplicaciones si aparecen necesidades concretas de experiencia o despliegue; no crear una app por función de antemano.

Separar responsabilidades:

1. Identidad y acceso: organizaciones, membresías y permisos; futuros perfiles de alumnos/mentores.
2. Configuración de programas: puestos objetivo, competencias, idiomas, mercados, marca y contenidos.
3. Motor de oportunidades: fuentes, proveedores, evidencia original, normalización, deduplicación y ranking.
4. Preparación: escenarios de roleplay, sesiones, rúbricas, evaluaciones y práctica de entrevistas.
5. Empleabilidad: perfil profesional, preferencias, matching, candidaturas y resultados.

Los módulos 4 y 5 son evolución, no autorización para implementarlos ahora. El portal y autoapply siguen fuera de la primera entrega del buscador. La arquitectura inicial debe permitirlos sin construirlos por adelantado.

## Implicaciones que deben incorporarse antes de implementar dominio/BD

- Definir aislamiento por organización desde la primera migración para búsquedas, configuraciones, destinos y datos privados. El modelo actual basado principalmente en owner_id necesita ampliación.
- Distinguir identidad de usuario, membresía en empresa e inscripción en programa. Una identidad no debe equivaler a una sola empresa o a un solo rol profesional.
- Hacer configurables taxonomías, alias, criterios de encaje y rúbricas. No fijar WDC, closer, género, España ni un único idioma en el dominio compartido.
- Mantener presentación localizada: WDC puede mostrar «alumnas» sin imponer esa terminología a otras empresas.
- Definir explícitamente si habrá catálogo común de ofertas públicas. Hasta resolverlo, no compartir capturas, comunidades privadas ni resultados entre empresas implícitamente.
- Distinguir relevancia para una búsqueda de adecuación a una persona; el futuro matching necesita perfil, preferencias y preparación demostrada.
- Las empresas colaboradoras aportadas por WDC pueden ser una fuente propia; mantener procedencia diferenciada de las ofertas externas.
- Autoapply deberá ser un módulo separado de los conectores de búsqueda, con autorización de la candidata, perfil validado, registro de envíos, control de duplicados y confirmación del resultado.

## Reutilización con el futuro producto de colaboradoras

Reutilizar patrones de conectores, timeouts, reintentos, presupuestos, métricas, normalización y skills cuando sean aplicables. Empleo e influencers conservan modelos de dominio y ranking propios.

No hacer que un repositorio importe rutas internas del otro ni compartir datos, secretos o bases de datos por comodidad. Extraer paquetes versionados solo cuando ambos productos tengan una necesidad real demostrada.

## Estado y precedencia

Este documento registra la aclaración del usuario posterior al paquete original. Prevalece respecto a identidad del producto, separación de Scalix y posibilidad de reutilización multiempresa. Las decisiones detalladas de arquitectura aquí recomendadas aún deben concretarse mediante ADR y actualizaciones de los contratos afectados.

No se ha creado un repositorio remoto, movido archivos ni implementado funcionalidades con esta actualización.
