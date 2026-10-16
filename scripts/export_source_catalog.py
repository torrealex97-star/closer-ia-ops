"""Exporta el catálogo de fuentes del backend (source_infos) a apps/web/lib/sourceCatalog.json.

El panel hospedado no tiene el backend local: muestra el catálogo completo desde este fichero y cruza
cada código con el estado real del motor cloud. Uso: PYTHONPATH=apps/api python scripts/export_source_catalog.py
tests/test_source_catalog_export.py comprueba que el fichero versionado sigue en sincronía.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'apps/web/lib/sourceCatalog.json'
FIELDS = ('code', 'name', 'category', 'website', 'acquisition_method', 'validation_status', 'requires', 'note', 'upstream_filters')


def build():
    os.environ.setdefault('CAREER_DB', str(Path(tempfile.mkdtemp()) / 'catalog.sqlite3'))
    from career.db import initialize, org
    from career.sources import source_infos
    initialize()
    rows = [i if isinstance(i, dict) else i.model_dump() for i in source_infos(org())]
    return [{k: r.get(k) for k in FIELDS} for r in rows]


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
    OUT.write_text(json.dumps(build(), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(build())} fuentes -> {OUT}')
