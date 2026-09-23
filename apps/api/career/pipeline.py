import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlsplit, urlunsplit
from .db import connect, now, uid
from .models import Job, SearchQuery

ALIASES = {
    "cold_caller": ["cold caller", "cold calling", "llamadas en frio", "prospector telefonico", "prospectora telefonica"],
    "closer": ["closer", "cerrador", "cerradora", "venta de alto valor", "ventas de alto valor", "closing specialist", "enrollment advisor", "enrollment specialist", "sales consultant"],
    "setter": ["appointment setter", "appoitment setter", "appointment setting", "agendador", "agendadora", "booking specialist", "lead qualifier", "dm setter", "outbound setter", "setter"],
    "sdr": ["sdr", "bdr", "sales development", "business development representative", "cold caller"],
    "account_executive": ["account executive", "ejecutivo comercial", "ejecutivo de ventas", "comercial digital", "asesor comercial", "asesora comercial"],
}
ALIASES["sales"] = list(dict.fromkeys(sum(ALIASES.values(), []) + ["sales", "ventas", "comercial", "business development"]))
ALIASES["digital_sales"] = list(dict.fromkeys(ALIASES["closer"] + ALIASES["setter"] + ALIASES["cold_caller"] + ["comercial", "asesor de ventas", "asesora de ventas", "agente de ventas", "ejecutivo de ventas", "ejecutiva de ventas", "representante de ventas"]))
LATAM = {"mexico", "méxico", "argentina", "colombia", "chile", "peru", "perú", "ecuador", "uruguay", "paraguay", "bolivia", "venezuela", "costa rica", "panama", "panamá", "guatemala", "honduras", "el salvador", "nicaragua", "dominican republic", "república dominicana", "brazil", "brasil", "latin america", "latam"}


def plain(value):
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", "", str(value or ""), flags=re.S | re.I)
    text = re.sub(r"</?(p|div|li|br|h[1-6])\b[^>]*>", "\n", text, flags=re.I)
    return re.sub(r"[ \t]+", " ", unescape(re.sub(r"<[^>]+>", "", text))).strip()[:40000]


def safe_url(value):
    try:
        parsed = urlsplit(str(value or ""))
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return ""
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    except ValueError:
        return ""


def date_value(value):
    if not value:
        return None
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value, timezone.utc)
        else:
            try:
                dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError:
                dt = parsedate_to_datetime(str(value))
        return dt.replace(tzinfo=dt.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def number(value):
    try:
        n = float(value)
        return n if 0 <= n < 1_000_000_000 else None
    except (TypeError, ValueError):
        return None


def normalize(source, row):
    if source == "getonbrd-public":
        attrs = row.get("attributes", {})
        item = normalize_mapped(row, {"title": "attributes.title", "source_url": "links.public_url", "locations": "attributes.countries", "published_at": "attributes.published_at"})
        item["description"] = "\n\n".join(plain(attrs.get(key)) for key in ["projects", "functions", "description", "desirable", "benefits"] if attrs.get(key))
        item["work_mode"] = {"fully_remote": "remote", "remote_local": "remote", "hybrid": "hybrid", "no_remote": "exclusivamente presencial"}.get(attrs.get("remote_modality"), "")
        # API does not expand company name or salary unit in this response.
        item["locations"] = [v for v in item["locations"] if v.lower() != "remote"]
        return item
    if source == "himalayas":
        locations = row.get("locationRestrictions")
        return {
            "title": plain(row.get("title")), "company": plain(row.get("companyName")) or "Empresa no indicada",
            "description": plain(row.get("description") or row.get("excerpt")),
            "source_url": safe_url(row.get("guid")), "application_url": safe_url(row.get("applicationLink")),
            "locations": [str(x) for x in locations] if isinstance(locations, list) else [],
            "published_at": date_value(row.get("pubDate")), "expires_at": date_value(row.get("expiryDate")),
            "salary_min": number(row.get("minSalary")), "salary_max": number(row.get("maxSalary")),
            "work_mode": "remote",
            "salary_currency": row.get("currency"), "salary_period": row.get("salaryPeriod"),
        }
    if source in {"remotive", "remoteok", "arbeitnow"}:
        fields = {
            "remotive": {"title": "title", "company": "company_name", "description": "description", "source_url": "url", "locations": "candidate_required_location", "published_at": "publication_date"},
            "remoteok": {"title": "position", "company": "company", "description": "description", "source_url": "url", "locations": "location", "published_at": "date"},
            "arbeitnow": {"title": "title", "company": "company_name", "description": "description", "source_url": "url", "locations": "location", "published_at": "created_at"},
        }[source]
        item = normalize_mapped(row, fields)
        if source != "arbeitnow" or row.get("remote") is True:
            item["work_mode"] = "remote"
        return item
    title = plain(row.get("title"))
    company, _, job_title = title.partition(":")
    region = plain(row.get("region"))
    return {
        "title": job_title.strip() or title, "company": company if job_title else "Empresa no indicada",
        "description": plain(row.get("description")), "source_url": safe_url(row.get("link")),
        "application_url": safe_url(row.get("link")), "locations": [region] if region else [],
        "published_at": date_value(row.get("pubDate")), "expires_at": None, "work_mode": "remote",
        "salary_min": None, "salary_max": None, "salary_currency": None, "salary_period": None,
    }



def folded(text):
    return "".join(c for c in unicodedata.normalize("NFD", str(text).lower()) if unicodedata.category(c) != "Mn")


def normalize_mapped(row, fields):
    def get(name):
        value = row
        for part in fields.get(name, "").split("."):
            if not isinstance(value, dict) or not part:
                return None
            value = value.get(part)
        return value
    locations = get("locations")
    if not isinstance(locations, list):
        locations = [locations] if isinstance(locations, str) and locations else []
    return {
        "title": plain(get("title")), "company": plain(get("company")) or "Empresa no indicada",
        "description": plain(get("description")), "source_url": safe_url(get("source_url")),
        "application_url": safe_url(get("application_url")) or safe_url(get("source_url")),
        "locations": [str(v) for v in locations if isinstance(v, str)],
        "published_at": date_value(get("published_at")), "expires_at": date_value(get("expires_at")),
        "work_mode": plain(get("work_mode")),
        "salary_min": number(get("salary_min")), "salary_max": number(get("salary_max")),
        "salary_currency": get("salary_currency") if isinstance(get("salary_currency"), str) else None,
        "salary_period": get("salary_period") if isinstance(get("salary_period"), str) else None,
    }


EUROPE = {"europe", "europa", "european union", "union europea", "eu", "eea", "emea", "spain", "espana", "portugal", "france", "francia", "germany", "alemania", "italy", "italia", "netherlands", "paises bajos", "ireland", "irlanda", "united kingdom", "uk", "reino unido", "belgium", "belgica", "switzerland", "suiza", "austria", "poland", "polonia", "greece", "grecia", "sweden", "suecia", "norway", "noruega", "finland", "finlandia", "denmark", "dinamarca", "romania", "rumania", "czechia", "czech republic", "czech republic", "bulgaria", "croatia", "croacia", "hungary", "hungria", "slovakia", "eslovaquia", "slovenia", "eslovenia", "estonia", "latvia", "letonia", "lithuania", "lituania", "malta", "cyprus", "chipre", "luxembourg", "luxemburgo", "iceland", "islandia", "serbia", "ukraine", "ucrania"}

def match(item: dict, query: SearchQuery):
    from .presentation import explicitly_closed
    if explicitly_closed(item["title"], item["description"]):
        return None
    title, body = folded(item["title"]), folded(item["description"])
    terms = ALIASES.get(query.role, [query.keywords.strip().lower()])
    terms = [t for t in terms if t]
    if not terms:
        return None
    def contains(text, term):
        return re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text) is not None
    if query.role == "digital_sales" and re.search(r"\b(?:director[ae]?|gerente|head|coordinador[ao]?|analista|inteligencia|operations|operaciones)\b", title):
        if not any(contains(title, term) for term in ALIASES["closer"] + ALIASES["setter"]):
            return None
    title_match = any(contains(title, term) for term in terms)
    # A passing mention of a sales team is not a sales vacancy. Without an LLM,
    # accept description-only evidence only in explicit hiring language.
    hiring_match = any(re.search(
        r"\b(?:hiring|seeking|looking for|busco|buscamos|estoy buscando|estamos buscando|se busca|necesitamos|contratamos|puesto de)\b(?:\s+\w+){0,4}\s+"
        + re.escape(term) + r"(?!\w)", body[:3000]) for term in terms)
    if not title_match and not hiring_match:
        return None
    if query.keywords.strip() and query.role != "custom":
        if not all(word in title + " " + body for word in query.keywords.lower().split()):
            return None
    reasons = ["Perfil mencionado en el título" if title_match else "Perfil mencionado en la descripción"]
    warnings = []
    score = 50 if title_match else 25
    text = title + " " + body
    work = folded(item.get("work_mode", ""))
    combined = work + " " + text
    hybrid = bool(re.search(r"\b(hybrid|hibrid[oa]|semi[ -]?presencial)\b", combined))
    remote = bool(re.search(r"\b(remote|remot[oa]|teletrabajo|home office|work from home|trabaj[oa] (?:desde casa|online|en linea))\b", combined))
    negative = bool(re.search(r"\b(no (?:es |se permite |ofrecemos )?(?:remote|remoto|teletrabajo)|not remote|on[ -]?site only|100% presencial|exclusivamente presencial|sin (?:opcion (?:a|de) )?teletrabajo)\b", combined))
    if work in {"onsite", "on-site", "on_site", "presencial", "no_remote", "in-office"}:
        negative = True
    if query.work_mode != "any":
        if negative or (query.work_mode == "remote" and hybrid) or not (remote or (hybrid and query.work_mode == "remote_hybrid")):
            return None
        reasons.append("Modalidad híbrida publicada" if hybrid else "Modalidad remota publicada")
        if hybrid:
            warnings.append("Híbrido: requiere presencia física; revisar ciudad y frecuencia")
    current = datetime.now(timezone.utc)
    if item.get("expires_at") and datetime.fromisoformat(item["expires_at"]) < current:
        return None
    published = item["published_at"]
    if published:
        days = (current - datetime.fromisoformat(published)).total_seconds() / 86400
        if days > query.days or days < -1:
            return None
        score += 20 if days <= 3 else 10
        reasons.append("Dentro del periodo seleccionado")
    elif not query.include_unknown:
        return None
    else:
        warnings.append("Fecha de publicación no confirmada")
    locations = {folded(v.strip()) for v in item["locations"]}
    global_scope = bool(locations & {"worldwide", "anywhere in the world", "anywhere", "global"})
    if query.market != "any":
        accepted = {"ES": {"spain", "españa", "es", "europe", "europa", "european union", "union europea", "eu", "eea"}, "US": {"united states", "usa", "us"}, "LATAM": {folded(v) for v in LATAM}, "EU": EUROPE}[query.market]
        if global_scope or any(contains(location, folded(country)) for location in locations for country in accepted):
            score += 15
            reasons.append("Ubicación compatible según la fuente")
        elif any(contains(location, country) for location in locations for country in
                 EUROPE | {folded(v) for v in LATAM} | {"united states", "usa", "us", "canada", "australia", "india", "china", "japan", "south africa"}):
            return None
        elif not query.include_unknown:
            return None
        else:
            warnings.append("Países permitidos sin confirmar: remoto no implica global")
    elif not locations:
        warnings.append("La fuente no especifica países permitidos")
    if query.require_spanish:
        from .presentation import language_evidence
        if not language_evidence(item['description'])['eligible']:
            return None
        reasons.append("Oferta redactada en español o con español mencionado")
        warnings.append("Confirmar idioma de trabajo y nivel de inglés si es bilingüe")
        score += 10
    if query.language != "any" and not query.require_spanish:
        terms_language = {"es": ["spanish", "espanol", "castellano"], "en": ["english", "ingles"]}[query.language]
        if any(contains(title + " " + body, term) for term in terms_language):
            reasons.append("Idioma mencionado; revisar el requisito en la oferta")
            score += 5
        elif not query.include_unknown:
            return None
        else:
            warnings.append("Idioma requerido sin confirmar")
    if query.salary_min:
        monthly = None
        if item["salary_currency"] == query.salary_currency and item["salary_min"] is not None:
            period = (item["salary_period"] or "").lower()
            if period in {"annual", "yearly", "year"}:
                monthly = item["salary_min"] / 12
            elif period in {"monthly", "month"}:
                monthly = item["salary_min"]
        if monthly is not None and monthly >= query.salary_min:
            score += 10
            reasons.append("Compensación publicada alcanza el mínimo; comprobar fijo/OTE")
        elif query.salary_mode == "strict":
            return None
        else:
            warnings.append("Compensación inferior o no comparable con la preferencia")
    if not item["salary_min"]:
        warnings.append("Compensación no publicada en campos estructurados")
    return min(score, 100), reasons, warnings


def ingest(candidate, connector, query, run_id, organization):
    serialized = json.dumps(candidate.payload, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(serialized.encode()).hexdigest()
    captured = now()
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO raw_items VALUES(?,?,?,?,?,?,?,?)",
                   (uid(), organization, connector.code, connector.provider, candidate.external_id, digest, serialized, captured))
        raw = db.execute("SELECT id,captured_at FROM raw_items WHERE org_id=? AND source=? AND external_id=? AND content_hash=?",
                         (organization, connector.code, candidate.external_id, digest)).fetchone()
    item = connector.normalize(candidate.payload) if hasattr(connector, "normalize") else normalize(connector.code, candidate.payload)
    if not item["title"] or not item["source_url"]:
        return False
    matching = match(item, query)
    if not matching:
        # A newer closed/changed listing must invalidate its previously accepted version.
        with connect() as db:
            db.execute('UPDATE job_postings SET raw_id=?,payload=? WHERE org_id=? AND source=? AND external_id=?',
                       (raw['id'], json.dumps(item), organization, connector.code, candidate.external_id))
        return False
    with connect() as db:
        posting = db.execute("SELECT id FROM job_postings WHERE org_id=? AND source=? AND external_id=?",
                             (organization, connector.code, candidate.external_id)).fetchone()
        posting_id = posting["id"] if posting else uid()
        db.execute("""INSERT INTO job_postings VALUES(?,?,?,?,?,?)
          ON CONFLICT(org_id,source,external_id) DO UPDATE SET raw_id=excluded.raw_id,payload=excluded.payload""",
                   (posting_id, organization, raw["id"], connector.code, candidate.external_id, json.dumps(item)))
        db.execute("INSERT OR IGNORE INTO jobs VALUES(?,?,?,0)", (uid(), organization, posting_id))
        job_id = db.execute("SELECT id FROM jobs WHERE org_id=? AND posting_id=?", (organization, posting_id)).fetchone()["id"]
        from .catalog import remember
        remember(db, organization, job_id, raw['captured_at'])
        score, reasons, warnings = matching
        item.pop("expires_at")
        item.pop("work_mode", None)
        job = Job(**item, id=job_id, source=connector.name, score=score, reasons=reasons,
                  warnings=warnings, raw_id=raw["id"], captured_at=raw["captured_at"], provider=connector.provider)
        if run_id is not None:
            db.execute("INSERT OR REPLACE INTO search_results VALUES(?,?,?,?)", (organization, run_id, job_id, job.model_dump_json()))
    return True
