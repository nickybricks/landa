$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$modelsDir = Join-Path $repoRoot "backend\models"
$dest = Join-Path $modelsDir "landa-base.bin"
$url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if (Test-Path $dest) {
    Write-Host "[Landa] Model already present: $dest"
    exit 0
}

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
Write-Host "[Landa] Downloading landa-base.bin from $url"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
Write-Host "[Landa] Model ready: $dest"
