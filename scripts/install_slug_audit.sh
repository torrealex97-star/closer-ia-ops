#!/bin/bash
# Instala la auditoría periódica de slugs JobToday (com.career.slug-audit) en launchd.
# - Crea el directorio de logs (~/.local/state/wdc-slug-audit/).
# - Copia el plist a ~/Library/LaunchAgents/ con las rutas reales de esta máquina.
# - Carga la tarea; prueba manual: launchctl start com.career.slug-audit
# Desinstalar: launchctl bootout gui/$(id -u)/com.career.slug-audit
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$REPO/scripts/com.career.slug-audit.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.career.slug-audit.plist"
LOG_DIR="$HOME/.local/state/wdc-slug-audit"

# 1) Validar el intérprete del repo (el plist apunta a .venv/bin/python del repo).
if [ ! -x "$REPO/.venv/bin/python" ]; then
  echo "ERROR: no existe $REPO/.venv/bin/python. Instala el venv según README.md." >&2
  exit 1
fi

# 2) Rellenar los placeholders del plist con las rutas reales.
mkdir -p "$LOG_DIR"
esc() { printf '%s' "$1" | sed 's/[\/&]/\\&/g'; }
sed -e "s|@VENV_PYTHON@|$(esc "$REPO")/.venv/bin/python|" \
    -e "s|@REPO@|$(esc "$REPO")|" \
    -e "s|@LOG_DIR@|$(esc "$LOG_DIR")|" \
    "$PLIST_SRC" > "$PLIST_DST"
plutil -lint "$PLIST_DST" >/dev/null || { echo "ERROR: plist generado inválido" >&2; exit 1; }

# 3) Cargar la tarea (bootout ignorado si no estaba cargada; gui/$UID es el dominio del usuario).
launchctl bootout "gui/$(id -u)/com.career.slug-audit" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/com.career.slug-audit"

echo "Instalada: com.career.slug-audit (2×/día: 09:30 y 21:30). Logs en $LOG_DIR."
echo "Prueba manual: launchctl start com.career.slug-audit && sleep 5 && cat $LOG_DIR/last-run.log"
