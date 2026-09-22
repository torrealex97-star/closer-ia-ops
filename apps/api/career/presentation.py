"""Evidence-based language and role rules shared by acquisition and student views."""
import re
import unicodedata


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def language_evidence(description):
    text = fold(description)
    english_only = bool(re.search(
        r'\b(?:english[- ]only|only (?:in )?english|strictly in english|exclusively in english|'
        r'english (?:remains|is) the (?:primary|sole|only) working language|'
        r'solo (?:en )?ingles|exclusivamente en ingles|idioma (?:principal|de trabajo)[: ]+ingles)\b', text))
    negative = bool(re.search(r'\b(?:spanish (?:is )?not (?:required|needed)|no (?:se )?requiere espanol)\b', text))
    # Count distinctive Spanish words, not shared Portuguese/English tokens or a footer mention.
    es = set(re.findall(r'\b(?:buscamos|ofrecemos|equipo|ventas|puesto|funciones|formacion|trabajar|'
                        r'nuestro|nuestra|tienes|seras|salario|horario|comisiones|'
                        r'necesitamos|incorporacion|llamadas|remuneracion|contratamos|tareas)\b', text))
    en = set(re.findall(r'\b(?:the|we|you|your|our|with|and|requirements|responsibilities|experience|'
                        r'must|will|looking|seeking|hiring|benefits|skills|required|qualifications)\b', text))
    spanish_text = len(es) >= 3 and len(es) >= len(en)
    # Required or used in the job; a nice-to-have/secondary Spanish mention isn't enough.
    clauses = re.split(r'[.!?\n]+', text)
    required_spanish = False
    required_english = False
    for clause in clauses:
        if re.search(r'\b(?:preferred|bonus|nice.to.have|optional|secondary|deseable|valorable|curso|course)\b', clause):
            continue
        if re.search(r'\b(?:spanish|espanol|castellano)\b', clause) and re.search(
                r'\b(?:bilingual|bilingue|fluent|fluency|required|must|proficien\w*|speaking|spoken|communication|'
                r'requiere|requerido|dominio|nativo|hablantes|idioma|atencion|clientes)\b', clause):
            required_spanish = True
        if re.search(r'\b(?:english|ingles)\b', clause) and re.search(
                r'\b(?:bilingual|fluent|fluency|required|must|proficien\w*|communication|requiere|requerido|dominio|nivel|bilingue)\b', clause):
            required_english = True
    return {'eligible': not english_only and not negative and (spanish_text or required_spanish),
            'spanish_text': spanish_text, 'english_required': required_english,
            'spanish_required': required_spanish, 'english_only': english_only}


def professional_role(title, description):
    title, body = fold(title), fold(description)
    if title == 'publicacion de comunidad':
        hiring = re.search(r'\b(?:busco|buscamos|necesitamos|contratamos|se busca|estamos buscando)\b(?:\s+\w+){0,4}\s+(closer|setter|cerrador[ae]?|appointment setter|cold caller)\b', body)
        if not hiring:
            return None
        title = hiring.group(1)
    if re.search(r'\b(?:cold caller|cold calling|llamadas en frio|prospector[ae]? telefonic[oa])\b', title):
        return 'cold_caller'
    if re.search(r'\b(?:setter|appointment setting|agendador[ae]?|booking specialist|lead qualifier)\b', title):
        return 'setter'
    if re.search(r'\b(?:closer|cerrador[ae]?|closing specialist|enrollment advisor|enrollment specialist|sales consultant)\b', title):
        return 'closer'
    if re.search(r'\b(?:comercial|ventas|sales|asesor[ae]?|enrollment)\b', title) and re.search(
            r'\b(?:cerrar (?:la |su |las )?(?:venta|inscripcion)|cierre (?:de |comercial)|closing (?:sales|deals))', body):
        return 'closer'
    return None
