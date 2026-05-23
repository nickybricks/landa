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

# macOS uses pywhispercpp for every model (default + downloadable); faster-whisper
# and its native deps (ctranslate2, onnxruntime, av, tokenizers) never run here, so
# exclude them — ~118 MB of dead weight. Windows (build_backend.ps1) still bundles them.
pyinstaller \
  --noconfirm \
  --onedir \
  --name landa_backend \
  --distpath dist \
  --workpath build \
  --specpath . \
  --add-data "models/landa-base.bin:models" \
  --exclude-module faster_whisper \
  --exclude-module ctranslate2 \
  --exclude-module onnxruntime \
  --exclude-module av \
  --exclude-module tokenizers \
  landa_core.py

deactivate
echo "[Landa] Backend binary ready at backend/dist/landa_backend/"
