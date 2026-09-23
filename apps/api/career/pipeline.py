import hashlib
import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlsplit, urlunsplit
from .db import connect, now, uid
from .models import Job, SearchQuery
from .vocabulary import (ALIASES as VOCAB_ALIASES, NEGATIVE_SIGNALS, QUALITY_SIGNALS,
                         SECTOR_TERMS)

# Canonical user taxonomy (2026-09-23) from vocabulary.py, extended with legacy aliases.
ALIASES = {role: list(dict.fromkeys(terms + VOCAB_ALIASES.get(role, [])))
           for role, terms in {
    "cold_caller": ["cold caller", "cold calling", "llamadas en frio", "prospector telefonico", "prospectora telefonica"],
    "closer": ["closer", "cerrador", "cerradora", "venta de alto valor", "ventas de alto valor", "closing specialist", "enrollment advisor", "enrollment specialist", "sales consultant"],
    "setter": ["appointment setter", "appoitment setter", "appointment setting", "agendador", "agendadora", "booking specialist", "lead qualifier", "dm setter", "outbound setter", "setter"],
    "sdr": ["sdr", "bdr", "sales development", "business development representative", "cold caller"],
    "account_executive": ["account executive", "ejecutivo comercial", "ejecutivo de ventas", "comercial digital", "asesor comercial", "asesora comercial"],
}.items()}
ALIASES["sales"] = list(dict.fromkeys(sum(ALIASES.values(), []) + ["sales", "ventas", "comercial", "business development", "telemarketing", "televentas"]))
ALIASES["digital_sales"] = list(dict.fromkeys(ALIASES["closer"] + ALIASES["setter"] + ALIASES["cold_caller"] + ALIASES["account_executive"] + ALIASES["sdr"] + VOCAB_ALIASES["digital_sales"] + ["comercial", "asesor de ventas", "asesora de ventas", "agente de ventas", "ejecutivo de ventas", "ejecutiva de ventas", "representante de ventas", "sales executive", "ejecutiva comercial", "televentas", "telemarketing", "televendedor", "televendedora"]))
# El vocabulario canonico incluye 'ventas'/'sales'/'comercial' como terminos genericos;
# aqui solo cuentan los perfiles y equivalentes del vocabulario (los genericos ya estaban).
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
                dt = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" UTC", "+00:00"))
            except ValueError:
                dt = parsedate_to_datetime(str(value))
        return dt.replace(tzinfo=dt.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def relative_date(text):
    """Explicit relative dates from providers ("3 days ago", "hace 2 días").
    Returns None on anything unrecognized: a gap is not a date."""
    if not isinstance(text, str):
        return None
    t = text.lower()
    m = re.search(r"(\d+)\s*(minuto|hour|hora|day|d[ií]a|week|semana|month|mes)\w*", t)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)[:2]
    seconds = {"mi": 60, "ho": 3600, "dá": 86400, "di": 86400, "se": 604800, "me": 2592000}.get(unit)
    if seconds is None:
        return None
    return date_value(time.time() - n * seconds)


def number(value):
    try:
        n = float(value)
        return n if 0 <= n < 1_000_000_000 else None
    except (TypeError, ValueError):
        return None


def normalize(source, row):
    if source == "google":
        # SerpApi engine=google_jobs (jobs_results verificado contra su documentación).
        # apply_links trae el enlace de la oferta; sin él la ficha no es clickable.
        apply = row.get("apply_options") or []
        link = safe_url(row.get("link")) or (safe_url(apply[0].get("link")) if isinstance(apply, list) and apply and isinstance(apply[0], dict) else "")
        via = row.get("via") or ""
        detected = row.get("detected_extensions", {}) if isinstance(row.get("detected_extensions"), dict) else {}
        posted = date_value(detected.get("posted_at"))
        if not posted and isinstance(detected.get("posted_at_relative"), str):
            # "3 days ago" / "hace 3 días": fecha relativa explícita, no inventada.
            posted = relative_date(detected["posted_at_relative"])
        locations = [str(loc) for loc in (row.get("location") or "").split(",") if str(loc).strip()]
        return {
            "title": plain(row.get("title")), "company": plain(via) or "Empresa no indicada",
            "description": plain(row.get("description")), "source_url": link or (safe_url(row.get("job_id")) or ""),
            "application_url": link, "locations": locations,
            "published_at": posted, "expires_at": None, "work_mode": "remote" if "remoto" in (row.get("location") or "").lower() or "remote" in (row.get("location") or "").lower() else "",
            "salary_min": number(detected.get("salary")) if isinstance(detected.get("salary"), (int, float)) else None,
            "salary_max": None, "salary_currency": None, "salary_period": None,
        }
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
    if source == "jobicy":
        item = normalize_mapped(row, {
            "title": "jobTitle", "company": "companyName", "description": "jobDescription",
            "source_url": "url", "locations": "jobGeo", "published_at": "pubDate",
        })
        item["work_mode"] = "remote"
        return item
    if source == "remotefirstjobs":
        title = plain(row.get("title"))
        company = title.rpartition(" at ")[2].strip()
        return {
            "title": title.rpartition(" at ")[0].strip() or title, "company": company or "Empresa no indicada",
            "description": plain(row.get("description")), "source_url": safe_url(row.get("link")),
            "application_url": safe_url(row.get("link")), "locations": [],
            "published_at": date_value(row.get("pubDate")), "expires_at": None, "work_mode": "remote",
            "salary_min": None, "salary_max": None, "salary_currency": None, "salary_period": None,
        }
    if source.startswith("jobtoday"):
        # Payload embebido de jobtoday.com/es (estructura verificada 2026-09-23).
        # Sin datos no se inventa nada: ubicación vacía va a revisión, salary desconocido queda nulo.
        canonical = row.get("canonicalUrl") or ""
        url = f"https://jobtoday.com{canonical}" if canonical.startswith("/") else safe_url(canonical)
        address = row.get("address")
        locations = [str(address)] if isinstance(address, str) and address.strip() else []
        posted = None
        created = row.get("createDate")
        if isinstance(created, (int, float)):
            # JobToday fecha en milisegundos; date_value interpreta segundos.
            posted = date_value(created / 1000)
        if not posted and isinstance(row.get("postedSecondsAgo"), (int, float)):
            posted = date_value(int(time.time() - row["postedSecondsAgo"]))
        salary = row.get("salary") if isinstance(row.get("salary"), dict) else {}
        salary_min, salary_max = number(salary.get("from")), number(salary.get("to"))
        if salary.get("isValid") is not True:
            salary_min = salary_max = None
        description = plain(row.get("description") or row.get("descriptionDeMarkdown"))
        work_mode = "remote" if "remoto" in source else ""
        return {
            "title": plain(row.get("role")), "company": plain(row.get("companyName")) or "Empresa no indicada",
            "description": description, "source_url": url, "application_url": url,
            "locations": locations, "published_at": posted, "expires_at": None,
            "work_mode": work_mode,
            "salary_min": salary_min, "salary_max": salary_max,
            "salary_currency": salary.get("currencyCode") if isinstance(salary.get("currencyCode"), str) else None,
            "salary_period": "monthly" if str(salary.get("period", "")).upper() == "MONTHLY" else None,
        }
    if source.startswith("ats-"):
        ats, _, _slug = source[4:].partition("-")
        if ats == "greenhouse":
            item = normalize_mapped(row, {
                "title": "title", "company": "company_name", "description": "",
                "source_url": "absolute_url", "locations": "location.name", "published_at": "first_published",
            })
            item["work_mode"] = ""
            return item
        if ats == "ashby":
            item = normalize_mapped(row, {
                "title": "title", "description": "descriptionPlain", "source_url": "jobUrl",
                "application_url": "applyUrl", "locations": "location", "published_at": "publishedAt",
                "work_mode": "workplaceType",
            })
            return item
        if ats == "teamtailor":
            # Feed RSS: título, descripción HTML, link, pubDate y ubicaciones tt:location.
            item = {
                "title": plain(row.get("title")), "company": plain(row.get("company_name")) or "Empresa no indicada",
                "description": plain(row.get("description")),
                "source_url": safe_url(row.get("link")), "application_url": safe_url(row.get("link")),
                "locations": [v for v in row.get("locations", []) if isinstance(v, str) and v.strip()],
                "published_at": date_value(row.get("pubDate")), "expires_at": None,
                "work_mode": "remote" if any("remoto" in str(v).lower() for v in row.get("locations", [])) else "",
                "salary_min": None, "salary_max": None, "salary_currency": None, "salary_period": None,
            }
            return item
        if ats == "recruitee":
            item = normalize_mapped(row, {
                "title": "title", "company": "company_name", "description": "description",
                "source_url": "careers_url", "published_at": "published_at",
                "salary_min": "salary.min", "salary_max": "salary.max",
                "salary_currency": "salary.currency", "salary_period": "salary.period",
            })
            requirements = plain(row.get("requirements"))
            if requirements:
                item["description"] = (item["description"] + "\n\n" + requirements)[:40000]
            item["locations"] = [str(loc.get("name") or loc.get("country") or "") for loc in row.get("locations", []) if isinstance(loc, dict)]
            item["locations"] = [v for v in item["locations"] if v]
            item["work_mode"] = "remote" if row.get("remote") is True else "hybrid" if row.get("hybrid") is True else ""
            return item
    if source == "workingnomads":
        item = normalize_mapped(row, {
            "title": "title", "company": "company_name", "description": "description",
            "source_url": "url", "locations": "location", "published_at": "pub_date",
        })
        item["work_mode"] = "remote"
        return item
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
    if source in {"virtualvocations", "remotejobs"}:
        title = plain(row.get("title"))
        company, _, job_title = title.partition(":")
        return {
            "title": job_title.strip() or title, "company": company if job_title else "Empresa no indicada",
            "description": plain(row.get("description")), "source_url": safe_url(row.get("link")),
            "application_url": safe_url(row.get("link")), "locations": [],
            "published_at": date_value(row.get("pubDate")), "expires_at": None, "work_mode": "remote",
            "salary_min": None, "salary_max": None, "salary_currency": None, "salary_period": None,
        }
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
    if query.role in {"digital_sales", "sales"} and re.search(r"\b(?:director[ae]?|gerente|gerenta|head|coordinador[ao]?|analista|inteligencia|operations|operaciones|lider|jefe|jefa|supervisor[ae]?|responsable|manager)\b", title):
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
    # Taxonomía WDC (2026-09-23): señales de calidad suben el score; el ruido
    # (cursos de closing, MLM, rentabilidad garantizada) no es una oportunidad.
    folded_all = title + " " + body
    quality = [s for s in QUALITY_SIGNALS if contains(folded_all, s)]
    if quality:
        score += min(2 * len(quality), 10)
        reasons.append("Señales de proceso comercial real: " + ", ".join(quality[:3]))
    if any(contains(folded_all, s) for s in SECTOR_TERMS):
        score += 5
        reasons.append("Sector high-ticket compatible")
    if any(contains(folded_all, s) for s in NEGATIVE_SIGNALS):
        return None
    from .vocabulary import COURSE_TERMS
    # Un curso que ENSEÑA a cerrar no es una vacante: solo si el título lo vende.
    if any(contains(title, s) for s in COURSE_TERMS):
        return None
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
