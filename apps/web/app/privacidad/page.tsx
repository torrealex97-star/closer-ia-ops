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
      <li><strong>Tus candidaturas:</strong> qué ofertas has preparado y en qué estado las has marcado (preparada, abierta, enviada, descartada).</li>
      <li><strong>Técnicos:</strong> cookies de sesión imprescindibles para mantenerte conectada. No usamos cookies de publicidad ni de seguimiento.</li>
    </ul>

    <h2>3. Para qué los usamos y con qué base</h2>
    <ul>
      <li>Darte acceso a tu espacio y mostrarte ofertas que encajan con tu perfil: <strong>ejecución del servicio que solicitas</strong> y, para el perfil, <strong>tu consentimiento</strong>.</li>
      <li>Ayudarte a preparar candidaturas (mensaje borrador y lista de datos para copiar): <strong>tu consentimiento</strong>. <strong>La app no envía nada por ti</strong>: copias y envías tú.</li>
      <li>Permiso de «autorrelleno futuro»: <strong>hoy no hace nada</strong>. Si lo marcas, solo queda registrado que lo autorizas; puedes retirarlo cuando quieras y se pedirá un permiso nuevo antes de usarlo.</li>
    </ul>
    <p>Las recomendaciones se calculan con reglas fijas y explicables. <strong>No enviamos tus datos personales a modelos de inteligencia artificial</strong> ni tomamos decisiones automatizadas sobre ti.</p>

    <h2>4. Con quién se comparten</h2>
    <ul>
      <li><strong>Proveedores que alojan el servicio</strong> (encargados del tratamiento): Supabase (base de datos y acceso; proyecto en la región de Irlanda) y Vercel (alojamiento de la aplicación). <em>Pendiente de confirmar por el responsable: contratos de encargado de tratamiento y, si procede, proveedor propio de correo.</em></li>
      <li><strong>Empresas de las ofertas:</strong> solo reciben tus datos cuando <strong>tú</strong> envías una candidatura por tu cuenta. Nosotras no se los enviamos.</li>
      <li>No vendemos ni cedemos tus datos a terceros con fines comerciales.</li>
    </ul>
    <p><em>Transferencias internacionales: el alojamiento puede implicar tratamiento fuera del Espacio Económico Europeo. Las garantías aplicables (cláusulas contractuales tipo u otras) están pendientes de confirmar por el responsable.</em></p>

    <h2>5. Cuánto tiempo los conservamos</h2>
    <p>Mientras tengas tu espacio activo. Puedes <strong>borrar tu perfil</strong> y tus datos de candidaturas desde tu espacio cuando quieras, y si te das de baja se elimina tu cuenta junto con ellos. <em>Plazos de conservación adicionales (copias de seguridad, obligaciones legales): pendientes de definir por el responsable.</em></p>

    <h2>6. Tus derechos</h2>
    <p>Puedes pedir acceso, rectificación, supresión, limitación, oposición y portabilidad, y retirar tu consentimiento en cualquier momento (sin que afecte a lo anterior), escribiendo a {e.email}. Parte de esto lo haces tú misma desde tu espacio (editar y borrar). Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>

    <h2>7. Menores</h2>
    <p>El servicio está pensado para personas mayores de edad.</p>

    <h2>8. Cambios</h2>
    <p>Si cambiamos esta política de forma relevante, te lo diremos y, si hace falta, te pediremos de nuevo tu consentimiento.</p>

    <p className="legal-meta">Versión {POLICY_VERSION} · {POLICY_DATE} · <a href="/alumna">Volver a tu espacio</a></p>
  </main>;
}
