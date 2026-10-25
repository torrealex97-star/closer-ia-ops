import { legalEntity, TERMS_DATE, TERMS_VERSION } from '../../lib/legal';

export const metadata = { title: 'Términos y condiciones · Women Digital Closer', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// BORRADOR redactado a partir de lo que el portal hace de verdad. NO es asesoramiento legal: debe revisarlo un profesional antes de
// abrir el acceso a las alumnas. Los puntos que dependen de una decisión del responsable o de la ley aplicable están marcados.
export default function Page() {
  const e = legalEntity();
  return <main className="legal" aria-labelledby="t">
    <p className="eyebrow">TÉRMINOS Y CONDICIONES</p>
    <h1 id="t">Cómo puedes usar el portal de alumnas</h1>
    <p className="legal-draft" role="note"><strong>Borrador pendiente de revisión legal.</strong> Describe lo que el portal hace hoy; todavía no lo ha revisado un profesional. Lo que depende de una decisión del responsable está marcado como «pendiente».</p>

    <h2>1. Quiénes somos y qué es el portal</h2>
    <p>El portal lo ofrece {e.name} (NIF/CIF: {e.taxId}), con domicilio en {e.address}. Es un espacio de formación y de apoyo a la búsqueda de trabajo para las alumnas de Women Digital Closers: ofertas, práctica de conversaciones, formación y seguimiento de tus candidaturas. Contacto: {e.email}. El tratamiento de tus datos se explica en la <a href="/privacidad">política de privacidad</a>.</p>

    <h2>2. Tu cuenta</h2>
    <ul>
      <li>El acceso es <strong>por invitación</strong>, personal e intransferible. Debes ser mayor de edad.</li>
      <li>Mantén tu contraseña en secreto y avísanos si crees que alguien más accede a tu cuenta.</li>
      <li>Podemos pausar o retirar el acceso si se incumplen estas normas. Puedes pedir tu baja cuando quieras; se elimina tu cuenta con sus datos, según la política de privacidad.</li>
    </ul>

    <h2>3. Lo que el portal es y lo que no es</h2>
    <ul>
      <li><strong>No garantizamos resultados</strong>: ni que consigas entrevistas, un trabajo, unos ingresos concretos ni un plazo. Depende de ti y de terceros.</li>
      <li>Las <strong>ofertas</strong> son anuncios publicados por terceros. Las reunimos y las filtramos con reglas, pero <strong>no las verificamos una a una</strong>, no somos parte del proceso de selección y la empresa puede haber cerrado el proceso: confírmalo en su web antes de enviar nada. <em>Pendiente de revisión legal: si reunir y recomendar ofertas requiere algún registro o autorización específica.</em></li>
      <li>La <strong>formación</strong> y el <strong>examen de egreso</strong> sirven para practicar. Aprobar el examen <strong>no es una certificación oficial ni un título</strong>.</li>
    </ul>

    <h2>4. Inteligencia artificial y notas</h2>
    <ul>
      <li>La sala de práctica usa un modelo de inteligencia artificial para hacer de interlocutor y dar feedback. Puede equivocarse o ser demasiado duro o demasiado amable.</li>
      <li>Las <strong>notas son estimaciones</strong> para que mejores, no una evaluación oficial ni una opinión sobre tu valía profesional, y no se usan para decidir nada sobre ti sin que una persona lo revise.</li>
      <li>No escribas en la sala datos personales de terceros ni información confidencial de tu empleo actual: lo que escribes se envía al proveedor de IA (ver privacidad).</li>
    </ul>

    <h2>5. Práctica por voz</h2>
    <p>Cuando la práctica por voz esté activa, necesitarás un consentimiento propio y retirable para usar el micrófono. No grabes ni compartas conversaciones de otras personas sin su permiso. <strong>Hoy esa función no está activa.</strong></p>

    <h2>6. Candidaturas</h2>
    <p>El portal te prepara un borrador y los datos para copiar. <strong>Eres tú quien revisa, completa y envía</strong> cada candidatura en la web de la empresa, y quien responde de que lo que envías es veraz. El portal no envía mensajes ni formularios por ti.</p>

    <h2>7. Normas de uso</h2>
    <ul>
      <li>Usa el portal para tu formación y tu búsqueda de trabajo, con información verdadera.</li>
      <li>No intentes acceder a datos o cuentas de otras personas, ni saturar o automatizar el servicio, ni burlar sus límites de uso.</li>
      <li>No copies ni redistribuyas el contenido formativo fuera del portal.</li>
    </ul>

    <h2>8. Contenidos y propiedad intelectual</h2>
    <p>Los contenidos formativos, la metodología y el diseño del portal son de {e.name} o de quien nos los licencia; los usas para tu aprendizaje personal. Los textos que escribes siguen siendo tuyos; nos permites tratarlos solo para prestarte el servicio.</p>

    <h2>9. Disponibilidad y terceros</h2>
    <p>Intentamos que el portal funcione de forma continua, pero puede haber interrupciones o cambios, y depende de servicios de terceros (alojamiento, base de datos, inteligencia artificial, navegador). Las ofertas y webs de empresas se rigen por sus propias condiciones.</p>

    <h2>10. Responsabilidad</h2>
    <p>Responderemos en los términos que permita la ley. <em>Pendiente de revisión legal: límites y exclusiones de responsabilidad, y régimen aplicable a consumidoras.</em></p>

    <h2>11. Ley aplicable y reclamaciones</h2>
    <p><em>Pendiente de completar por el responsable: ley aplicable, jurisdicción y canal de reclamaciones.</em></p>

    <h2>12. Cambios</h2>
    <p>Si cambiamos estos términos de forma relevante, te lo diremos y, si hace falta, te pediremos que los aceptes de nuevo.</p>

    <p className="legal-meta">Versión {TERMS_VERSION} · {TERMS_DATE} · <a href="/privacidad">Privacidad</a> · <a href="/alumna">Volver a tu espacio</a></p>
  </main>;
}
