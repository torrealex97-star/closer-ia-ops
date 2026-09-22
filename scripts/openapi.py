import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))
from career.main import app  # noqa: E402
(root / "packages/contracts/openapi.json").write_text(json.dumps(app.openapi(), indent=2) + "\n")
