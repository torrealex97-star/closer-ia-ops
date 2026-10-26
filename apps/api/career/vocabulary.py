"""Canonical WDC search vocabulary (user taxonomy, 2026-09-23).

Single source of truth for the role families used by match(), the presentation
classifier and the source presets. Many employers never say "closer": they
publish "asesor de admisiones", "sales advisor" or "patient coordinator" for the
same high-ticket closing job. Terms are stored folded (no accents): matching
code folds both the offer text and these terms, so accents must not survive here.
"""
import unicodedata


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', str(text).lower()) if unicodedata.category(c) != 'Mn')


# --- 1-5. Role families: each term matches a job TITLE; families feed ALIASES ---
ROLE_FAMILIES = {
    'closer': [
        'closer', 'closer de ventas', 'closer comercial', 'closer high ticket',
        'high ticket closer', 'high-ticket closer', 'closer high-ticket', 'closer de alto ticket', 'closer senior', 'closer b2c',
        'closer b2b', 'closer remoto', 'closser', 'clouser', 'sales closer',
        'especialista en cierre', 'experto en cierre de ventas', 'cerrador de ventas',
        'cerrador comercial', 'cerrador high ticket', 'cerrador de ventas inmobiliarias',
        'cerradora de ventas', 'comercial closer', 'vendedor consultivo',
        'asesor de ventas consultivas', 'venta consultiva', 'ventas consultivas',
        'consultative sales', 'solution selling', 'ventas complejas',
        'full-cycle sales', 'full cycle sales', 'end-to-end sales',
        'closing specialist', 'closing consultant', 'conversion specialist',
        'enrollment advisor', 'enrollment counselor', 'enrollment specialist',
        'enrollment consultant', 'admissions advisor', 'admissions associate',
        'admissions counselor', 'admissions officer', 'admissions consultant',
        'asesor de admisiones', 'asesora de admisiones', 'asesor/a de admisiones',
        'agente de admisiones', 'especialista de admisiones', 'ejecutivo de admisiones',
        'admisiones', 'asesor educativo', 'asesora educativa', 'consultor educativo',
        'orientador academico', 'orientadora academica', 'orientador educativo',
        'asesor de formacion', 'asesor comercial educativo', 'asesor de matricula',
        'ejecutivo de matricula', 'asesor de bootcamp', 'venta de formacion',
        'venta de cursos', 'venta de masters', 'venta de bootcamps',
        'student advisor', 'student enrollment advisor', 'student recruitment advisor',
        'programme advisor', 'program advisor', 'education advisor',
        'academic advisor', 'course advisor', 'bootcamp advisor',
        'patient advisor', 'patient coordinator', 'treatment coordinator',
        'treatment consultant', 'healthcare sales', 'medical sales advisor',
        'asesor de pacientes', 'cierre de matriculas', 'cierre de inscripciones',
        'cierre de ventas', 'cierre comercial', 'cierre de negocios',
    ],
    'setter': [
        'setter', 'appointment setter', 'sales setter', 'high-ticket setter',
        'high ticket setter', 'setter de ventas', 'setter comercial', 'setter digital',
        'setter b2b', 'setter b2c', 'setter closer', 'setter/closer', 'setter + closer',
        'appointment booker', 'appointment coordinator', 'agendador de citas',
        'agendadora de citas', 'generador de citas', 'concertador de citas',
        'concertador comercial', 'captador de citas', 'captador de leads',
        'cualificador de leads', 'calificador de leads', 'lead qualifier',
        'lead qualification specialist', 'sales appointment setter',
        'business appointment setter', 'teleconcertador', 'teleoperador comercial',
        'lead generation specialist', 'lead generation',
        'especialista en generacion de leads', 'especialista en prospeccion',
    ],
    'cold_caller': [
        'cold caller', 'cold calling', 'llamadas en frio', 'llamadas en frio',
        'prospector telefonico', 'prospectora telefonica', 'prospeccion telefonica',
    ],
    'account_executive': [
        'account executive', 'ejecutivo de cuentas', 'ejecutiva de cuentas',
        'account manager', 'sales executive', 'sales consultant', 'sales advisor',
        'sales specialist', 'sales representative', 'commercial advisor',
        'commercial executive', 'business development executive',
        'ejecutivo comercial', 'ejecutiva comercial', 'ejecutivo de ventas',
        'ejecutivo(a) comercial', 'ejecutiva(o) comercial',
        'ejecutiva de ventas', 'asesor comercial', 'asesora comercial',
        'asesor/a comercial', 'asesor comercial senior', 'representante comercial',
        'representante de ventas', 'representante de ventas senior', 'agente comercial',
        'agente de ventas', 'gestor comercial', 'gestora comercial', 'gestor de ventas',
        'especialista comercial', 'profesional de ventas', 'tecnico comercial',
        'tecnica comercial', 'televendedor', 'televendedora', 'televentas',
        'telemarketing', 'ventas telefonicas', 'ventas por videollamada',
        'consultor comercial', 'consultora comercial', 'consultor de ventas',
        'asesor de ventas', 'asesora de ventas',
        # Variantes con barra del mercado español, plegadas con evidencia del slug
        # asesor-de-ventas (sesión 22, 2026-10-15): 17/48 anuncios comerciales reales
        # quedaban sin familia. La familia closer NO se pliega (ver worker.js).
        'asesor/a de ventas',
        'asesor inmobiliario', 'asesor/a inmobiliario', 'asesor/a inmobiliario/a',
        'asesores inmobiliarios', 'agente inmobiliario', 'agentes inmobiliarios',
        'agente inmobiliario/a', 'vendedor', 'vendedora', 'vendedor/a',
        'asesor de programas', 'asesor de cursos', 'asesor de masters',
        'comercial digital', 'comercial online', 'inside sales',
        'inside sales representative', 'inside sales specialist',
        'inbound sales representative', 'outbound sales representative',
        'sales development representative', 'business development representative',
        'representante de desarrollo de ventas', 'representante de desarrollo comercial',
        'lead development representative', 'sales development specialist',
        'pre-sales representative', 'customer acquisition specialist',
        'customer conversion specialist', 'business development manager',
        'sales account executive', 'senior sales executive', 'remote sales consultant',
        'high-ticket sales consultant', 'high ticket sales consultant',
    ],
}
ROLE_FAMILIES['sdr'] = [
    'sdr', 'bdr', 'sales development', 'business development representative',
    'cold caller', 'business development executive',
]

# digital_sales = union de todas las familias + genericos: es el perfil por defecto del buscador.
DIGITAL_SALES_EXTRA = [
    'high ticket sales', 'high-ticket sales',
    'experto en ventas', 'experta en ventas', 'experto/a en ventas', 'closers',
    'venta de alto valor', 'ventas de alto valor', 'vendedor high ticket',
    'captacion de alumnos',
    'captacion de estudiantes', 'matriculacion', 'matriculas', 'inscripciones',
    'asesor de inscripciones', 'asesora de inscripciones',
]

ALIASES = {name: sorted(set(terms)) for name, terms in ROLE_FAMILIES.items()}
# Sin genericos ('ventas'/'sales'/'comercial'): un titulo que solo dice "ventas"
# puede ser lider de equipo, formación o RRHH; match() ya los usa por substring
# en descripcion via hiring language. Los perfiles y equivalentes bastan aqui.
ALIASES['digital_sales'] = sorted(set(
    sum(ALIASES.values(), []) + DIGITAL_SALES_EXTRA))
ALIASES['sales'] = sorted(set(
    ALIASES['digital_sales'] + ['business development', 'cierre consultivo']))

# Etiquetas visibles para cada rol (formularios y vista de oportunidades).
ROLE_LABELS = {
    'digital_sales': 'Closers, setters y comercial online',
    'closer': 'Closer de ventas',
    'setter': 'Appointment setter',
    'cold_caller': 'Cold Caller',
    'account_executive': 'Account executive',
    'sdr': 'SDR / BDR',
    'sales': 'Ventas · búsqueda amplia',
}

# --- 6. Sector / programme signals (high-ticket context) ---
SECTOR_TERMS = [
    'high ticket', 'high-ticket', 'premium program', 'programa premium',
    'programa de alto valor', 'programa de transformacion', 'mentoria premium',
    'mentoria high ticket', 'coaching premium', 'consultoria premium',
    'servicio premium', 'programa de acompanamiento', 'mastermind', 'incubadora',
    'aceleradora', 'programa intensivo', 'bootcamp', 'master', 'formacion ejecutiva',
    'executive education', 'certificacion profesional', 'formacion online',
    'escuela online', 'educacion digital', 'edtech', 'universidad online',
    'formacion profesional', 'inversion inmobiliaria', 'real estate', 'trading',
    'educacion financiera', 'consultoria b2b', 'agencia de marketing',
    'agencia de ia', 'performance marketing', 'saaS', 'software empresarial',
    'software b2b', 'soluciones digitales', 'clinica estetica', 'medicina estetica',
    'clinica dental', 'clinica capilar', 'trasplante capilar', 'fertilidad',
    'reproduccion asistida', 'clinica de fertilidad', 'cirugia estetica',
    'nutricion online', 'wellness', 'mentor', 'mentoria', 'coaching',
    'infoproducto', 'negocio online', 'automatizacion', 'inteligencia artificial',
]

# --- 7. Hiring & quality signals: evidence of a real sales process ---
QUALITY_SIGNALS = [
    'leads cualificados', 'leads calificados', 'leads calientes', 'warm leads',
    'qualified leads', 'llamadas agendadas', 'citas agendadas', 'booked calls',
    'leads proporcionados', 'leads provided', 'leads inbound', 'inbound leads',
    'cartera de clientes', 'agenda propia', 'comisiones sin techo',
    'uncapped commission', 'uncapped commissions', 'comision por venta',
    'comisiones por venta', 'salario fijo mas comisiones', 'fijo mas variable',
    'fijo mas comisiones', 'base salary plus commission', 'salario base mas comision',
    'sueldo fijo y variable', 'variable por objetivos', 'bonus por cierre',
    'bonus por objetivos', 'contrato indefinido', 'contrato mercantil',
    'colaboracion freelance', 'autonomo comercial', 'freelance comercial',
    'ticket medio', 'ticket de 2.000', 'tickets de 5.000', 'alta de clientes',
    'cierre de ventas', 'con experiencia en cierre', 'experiencia comercial',
    'crm', 'discovery calls', 'videollamadas', 'ote',
    'on-target earnings', 'incorporacion inmediata', 'ampliamos equipo',
    'unete al equipo', 'trabaja con nosotros',
]

# --- 12. Negative signals: courses-selling-closing, MLM, guaranteed-return scams ---
NEGATIVE_SIGNALS = [
    'mlm', 'network marketing', 'multinivel', 'multinivel marketing',
    'rentabilidad garantizada', 'inversion garantizada', 'inversiones garantizadas',
    'ganancias garantizadas', 'criptomonedas garantizadas', 'senales de trading',
    'comision por reclutamiento', 'gana dinero sin', 'dinero facil',
]

# Courses ABOUT closing (bought, not jobs): only matched as a full phrase.
COURSE_TERMS = [
    'curso de closing', 'curso de closer', 'formacion de closer', 'formacion de closing',
    'masterclass de closing', 'certificacion de closer', 'aprende a cerrar',
    'conviertete en closer', 'hazte closer', 'escuela de closers', 'cerrar mas ventas curso',
]
