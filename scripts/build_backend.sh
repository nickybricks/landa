#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

bash "$REPO_ROOT/scripts/fetch_landa_models.sh"

echo "[Landa] Building Python backend with PyInstaller..."
cd "$BACKEND_DIR"

python3 -m venv build_venv
source build_venv/bin/activate

pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
pip install --quiet pyinstaller

pyinstaller \
  --noconfirm \
  --onedir \
  --name landa_backend \
  --distpath dist \
  --workpath build \
  --specpath . \
  --add-data "models/landa-base.bin:models" \
  landa_core.py

deactivate
echo "[Landa] Backend binary ready at backend/dist/landa_backend/"
