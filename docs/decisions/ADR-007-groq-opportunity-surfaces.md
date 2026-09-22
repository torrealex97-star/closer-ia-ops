# ADR-007 — Groq, proyección WDC y expansión US hispana

Fecha: 2026-09-22. Estado: aceptado para arquitectura y planificación; implementación pendiente.
Origen: nueva decisión explícita del usuario. Complementa ADR-002/005 y ADR-006, sin eliminar evidencia ni aislamiento multiempresa.

## Decisión

1. Groq es proveedor principal de toda IA detrás de LLMProvider; parsers deterministas siguen siendo el primer paso. OpenAI implementado se encapsulará como adaptador secundario opt-in, sin fallback automático de pago.
2. raw → posting → job conserva trazabilidad completa. Se añade WDCOpportunity como proyección editorial versionada por organización, idioma y política.
3. Admin y alumna consumen contratos separados; ocultar columnas en frontend no constituye autorización.
4. connection_type y application_type son independientes. Una URL corporativa no acredita una relación comercial.
5. Expansión US separa mercado de clientes, país de empresa, lugar de residencia permitido e idioma. Prioriza acceso público sin cuentas personales y presupuesto medido.

## Consecuencias

Nueva migración, contratos DTO, verificación de vigencia y relación, política de publicación, adaptador Groq y evaluación ES/EN. No activar fuentes ni gastos por añadir su ficha documental. No se cambia el runtime en esta entrega documental.

Prevalece sobre requisitos anteriores incompatibles de proveedor único, fuente protagonista, fecha de descubrimiento como publicación y “92% match” sin calibración. Especificaciones detalladas: [IA](../spec/16_LLM_PROVIDER_GROQ.md), [experiencia](../spec/17_WDC_OPPORTUNITY_EXPERIENCE.md), [fuentes](../spec/18_US_HISPANIC_SOURCE_RESEARCH.md).
