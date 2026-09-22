import hashlib
import json
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlsplit, urlunsplit
from .db import connect, now, uid
from .models import Job, SearchQuery

ALIASES = {
    "closer": ["closer", "closing specialist", "enrollment advisor", "enrollment specialist", "sales consultant"],
    "setter": ["appointment setter", "appointment setting", "booking specialist", "lead qualifier", "dm setter", "outbound setter", "setter"],
    "sdr": ["sdr", "bdr", "sales development", "business development representative", "cold caller"],
    "account_executive": ["account executive", "ejecutivo comercial", "ejecutivo de ventas"],
}
ALIASES["sales"] = list(dict.fromkeys(sum(ALIASES.values(), []) + ["sales", "ventas", "comercial", "business development"]))
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
    if source == "himalayas":
        locations = row.get("locationRestrictions")
        return {
            "title": plain(row.get("title")), "company": plain(row.get("companyName")) or "Empresa no indicada",
            "description": plain(row.get("description") or row.get("excerpt")),
            "source_url": safe_url(row.get("guid")), "application_url": safe_url(row.get("applicationLink")),
            "locations": [str(x) for x in locations] if isinstance(locations, list) else [],
            "published_at": date_value(row.get("pubDate")), "expires_at": date_value(row.get("expiryDate")),
            "salary_min": number(row.get("minSalary")), "salary_max": number(row.get("maxSalary")),
            "salary_currency": row.get("currency"), "salary_period": row.get("salaryPeriod"),
        }
    title = plain(row.get("title"))
    company, _, job_title = title.partition(":")
    region = plain(row.get("region"))
    return {
        "title": job_title.strip() or title, "company": company if job_title else "Empresa no indicada",
        "description": plain(row.get("description")), "source_url": safe_url(row.get("link")),
        "application_url": safe_url(row.get("link")), "locations": [region] if region else [],
        "published_at": date_value(row.get("pubDate")), "expires_at": None,
        "salary_min": None, "salary_max": None, "salary_currency": None, "salary_period": None,
    }


def match(item: dict, query: SearchQuery):
    title, body = item["title"].lower(), item["description"].lower()
    terms = ALIASES.get(query.role, [query.keywords.strip().lower()])
    terms = [t for t in terms if t]
    if not terms:
        return None
    def contains(text, term):
        return re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text) is not None
    title_match = any(contains(title, term) for term in terms)
    # A passing mention of a sales team is not a sales vacancy. Without an LLM,
    # accept description-only evidence only in explicit hiring language.
    hiring_match = any(re.search(
        r"\b(?:hiring|seeking|looking for|buscamos|contratamos|puesto de)\b(?:\s+\w+){0,4}\s+"
        + re.escape(term) + r"(?!\w)", body[:3000]) for term in terms)
    if not title_match and not hiring_match:
        return None
    if query.keywords.strip() and query.role != "custom":
        if not all(word in title + " " + body for word in query.keywords.lower().split()):
            return None
    reasons = ["Perfil mencionado en el título" if title_match else "Perfil mencionado en la descripción"]
    warnings = []
    score = 50 if title_match else 25
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
    locations = {v.strip().lower() for v in item["locations"]}
    global_scope = bool(locations & {"worldwide", "anywhere in the world", "anywhere", "global"})
    if query.market != "any":
        accepted = {"ES": {"spain", "españa", "es", "europe", "european union"}, "US": {"united states", "usa", "us"}, "LATAM": LATAM}[query.market]
        if global_scope or locations & accepted:
            score += 15
            reasons.append("Ubicación compatible según la fuente")
        elif locations:
            return None
        elif not query.include_unknown:
            return None
        else:
            warnings.append("Países permitidos sin confirmar: remoto no implica global")
    elif not locations:
        warnings.append("La fuente no especifica países permitidos")
    if query.language != "any":
        terms_language = {"es": ["spanish", "español", "castellano"], "en": ["english", "inglés"]}[query.language]
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
    item = normalize(connector.code, candidate.payload)
    if not item["title"] or not item["source_url"]:
        return False
    matching = match(item, query)
    if not matching:
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
        score, reasons, warnings = matching
        item.pop("expires_at")
        job = Job(**item, id=job_id, source=connector.name, score=score, reasons=reasons,
                  warnings=warnings, raw_id=raw["id"], captured_at=raw["captured_at"], provider=connector.provider)
        db.execute("INSERT OR REPLACE INTO search_results VALUES(?,?,?,?)", (organization, run_id, job_id, job.model_dump_json()))
    return True
