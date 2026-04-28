#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$REPO_ROOT/backend/models"
DEST="$MODELS_DIR/landa-base.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if [ -f "$DEST" ]; then
  echo "[Landa] Model already present: $DEST"
  exit 0
fi

mkdir -p "$MODELS_DIR"
echo "[Landa] Downloading landa-base.bin from $URL"
curl -L --fail --progress-bar -o "$DEST" "$URL"
echo "[Landa] Model ready: $DEST"
