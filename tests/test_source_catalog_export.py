"""El catálogo que ve el panel hospedado (sourceCatalog.json) debe coincidir con el del backend."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from export_source_catalog import OUT, build  # noqa: E402


def test_hosted_source_catalog_matches_backend():
    assert json.loads(OUT.read_text(encoding='utf-8')) == build(), 'Regenera: PYTHONPATH=apps/api python scripts/export_source_catalog.py'


def test_catalog_has_all_sources_and_unique_codes():
    rows = json.loads(OUT.read_text(encoding='utf-8'))
    codes = [r['code'] for r in rows]
    assert len(codes) == len(set(codes)) and len(codes) >= 60
