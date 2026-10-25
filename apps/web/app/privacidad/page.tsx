import { legalEntity, POLICY_DATE, POLICY_VERSION } from '../../lib/legal';

export const metadata = { title: 'Privacidad · Women Digital Closer', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// BORRADOR redactado a partir de lo que la app hace de verdad (datos, finalidades, proveedores, borrado). NO es asesoramiento legal:
// debe revisarlo un profesional antes de abrir el acceso a las alumnas. Cada punto dudoso está marcado.
export default function Page() {
  const e = legalEntity();
  return <main className="legal" aria-labelledby="t">
    <p className="eyebrow">POLÍTICA DE PRIVACIDAD</p>
    <h1 id="t">Cómo tratamos tus datos</h1>
    <p className="legal-draft" role="note"><strong>Borrador pendiente de revisión legal.</strong> Este texto describe lo que la aplicación hace hoy; todavía no ha sido revisado por un profesional. Los datos del responsable aparecen como «pendiente de completar» hasta que se rellenen.</p>

    <h2>1. Quién es el responsable</h2>
    <p>{e.name} (NIF/CIF: {e.taxId}), con domicilio en {e.address}. Contacto de privacidad: {e.email}.</p>

    <h2>2. Qué datos tratamos</h2>
    <ul>
      <li><strong>Cuenta:</strong> tu correo electrónico y tu contraseña (la contraseña no la conocemos: se guarda cifrada por el servicio de acceso).</li>
      <li><strong>Perfil (lo rellenas tú):</strong> nombre, ciudad, perfiles que te interesan, idiomas, disponibilidad y, si quieres, el <em>enlace</em> a tu vídeo de presentación. <strong>No subimos ni guardamos tu vídeo</strong>: solo el enlace a tu propio Drive.</li>
      <li><strong>Formulario base de candidaturas (opcional):</strong> datos de contacto, enlace a tu CV, país de residencia, autorización de trabajo, niveles de idioma, años de experiencia y respuestas habituales de formularios.</li>
      <li><strong>Tu actividad en el portal:</strong> los días que entras, los módulos de formación que repasas, la nota del examen de egreso (la calcula el servidor con tus respuestas) y, de cada práctica de la sala, el escenario, la nota y la nota por criterio. <strong>No guardamos el texto de tus conversaciones</strong>: el historial de la sala queda en tu navegador.</li>
      <li><strong>Lo que escribes o dices en la sala de práctica:</strong> el texto de la conversación se envía a un proveedor de inteligencia artificial para simular al interlocutor y darte feedback (ver el apartado 4). Si usas el dictado o la lectura en voz alta, <strong>tu navegador</strong> procesa el audio.</li>
      <li><strong>Tus candidaturas:</strong> qué ofertas has preparado y en qué estado las has marcado (preparada, abierta, enviada, descartada y, si lo anotas tú, respuesta de la empresa, entrevista, oferta o respuesta negativa).</li>
      <li><strong>Técnicos:</strong> cookies de sesión imprescindibles para mantenerte conectada. No usamos cookies de publicidad ni de seguimiento.</li>
    </ul>

    <h2>3. Para qué los usamos y con qué base</h2>
    <ul>
      <li>Darte acceso a tu espacio y mostrarte ofertas que encajan con tu perfil: <strong>ejecución del servicio que solicitas</strong> y, para el perfil, <strong>tu consentimiento</strong>.</li>
      <li>Ayudarte a preparar candidaturas (mensaje borrador y lista de datos para copiar): <strong>tu consentimiento</strong>. <strong>La app no envía nada por ti</strong>: copias y envías tú.</li>
      <li><strong>Seguir tu progreso</strong> (tu actividad, tus notas y tus candidaturas): para mostrártelo a ti y para que el <strong>equipo de coordinación de WDC</strong> te acompañe y vea cómo va la comunidad: <strong>ejecución del servicio que solicitas</strong>. <em>Pendiente de confirmar por el responsable: base legal y plazos.</em></li>
      <li>Permiso de «autorrelleno futuro»: <strong>hoy no hace nada</strong>. Si lo marcas, solo queda registrado que lo autorizas; puedes retirarlo cuando quieras y se pedirá un permiso nuevo antes de usarlo.</li>
    </ul>
    <p>Las recomendaciones, el nivel y las estadísticas se calculan con reglas fijas y explicables. <strong>No enviamos tu perfil, tu CV ni tus datos de contacto a modelos de inteligencia artificial</strong> ni tomamos decisiones automatizadas sobre ti. La coordinación puede ver una <strong>sugerencia</strong> de alumnas candidatas a un proyecto, calculada con reglas visibles (examen superado, prácticas con buena nota media y candidaturas enviadas); <strong>la decide una persona</strong> y no afecta a tu acceso. La excepción es lo que tú escribes o dices en la sala de práctica (ver apartado 4), y las notas que da son <strong>estimaciones</strong>, no evaluaciones oficiales.</p>

    <h2>4. Con quién se comparten</h2>
    <ul>
      <li><strong>Proveedores que alojan el servicio</strong> (encargados del tratamiento): Supabase (base de datos y acceso; proyecto en la región de Irlanda) y Vercel (alojamiento de la aplicación). <em>Pendiente de confirmar por el responsable: contratos de encargado de tratamiento y, si procede, proveedor propio de correo.</em></li>
      <li><strong>Proveedor de inteligencia artificial para la sala de práctica</strong> (Groq): recibe el <em>texto</em> de la conversación de práctica, sin tu nombre, correo ni perfil, para generar las respuestas del interlocutor y el feedback. <em>Pendiente de confirmar por el responsable: acuerdo de tratamiento y retención cero con el proveedor antes de abrir la sala a las alumnas.</em></li>
      <li><strong>Reconocimiento y síntesis de voz del navegador</strong> (dictado y lectura en voz alta): lo ofrece tu navegador y, según cuál uses, puede enviar el audio a su propio proveedor (por ejemplo Google en Chrome); consulta sus condiciones. Nosotras no recibimos ni guardamos el audio.</li>
      <li><strong>Empresas de las ofertas:</strong> solo reciben tus datos cuando <strong>tú</strong> envías una candidatura por tu cuenta. Nosotras no se los enviamos.</li>
      <li><strong>Equipo de coordinación de WDC</strong> (las personas con acceso al panel de administración): ve tu actividad, tus notas, el estado de tus candidaturas y tu perfil para acompañarte. No ve tus conversaciones de la sala (no las guardamos).</li>
      <li>No vendemos ni cedemos tus datos a terceros con fines comerciales.</li>
    </ul>
    <p><em>Transferencias internacionales: el alojamiento puede implicar tratamiento fuera del Espacio Económico Europeo. Las garantías aplicables (cláusulas contractuales tipo u otras) están pendientes de confirmar por el responsable.</em></p>

    <h2>5. Cuánto tiempo los conservamos</h2>
    <p>Mientras tengas tu espacio activo. Puedes <strong>borrar tu perfil</strong> y tus datos de candidaturas desde tu espacio cuando quieras, y si te das de baja se elimina tu cuenta junto con ellos. <em>Plazos de conservación adicionales (copias de seguridad, obligaciones legales): pendientes de definir por el responsable.</em></p>

    <h2>6. Tus derechos</h2>
    <p>Puedes pedir acceso, rectificación, supresión, limitación, oposición y portabilidad, y retirar tu consentimiento en cualquier momento (sin que afecte a lo anterior), escribiendo a {e.email}. Parte de esto lo haces tú misma desde tu espacio (editar y borrar). Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>

    <h2>7. Práctica por voz (cuando se active)</h2>
    <p>La práctica por voz con conversación continua <strong>todavía no está activa</strong>. Antes de usarla te pediremos un <strong>consentimiento propio, separado y retirable</strong>, y te explicaremos qué audio o transcripción se trata, dónde y durante cuánto tiempo. Hasta que ese texto esté revisado, no se tratará audio de alumnas con esta función. <em>Pendiente de revisión legal.</em></p>

    <h2>8. Menores</h2>
    <p>El servicio está pensado para personas mayores de edad.</p>

    <h2>9. Cambios</h2>
    <p>Si cambiamos esta política de forma relevante, te lo diremos y, si hace falta, te pediremos de nuevo tu consentimiento.</p>

    <p className="legal-meta">Versión {POLICY_VERSION} · {POLICY_DATE} · <a href="/terminos">Términos y condiciones</a> · <a href="/alumna">Volver a tu espacio</a></p>
  </main>;
}
