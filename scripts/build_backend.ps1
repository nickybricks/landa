$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "fetch_landa_models.ps1")

Write-Host "[Landa] Building Python backend with PyInstaller..."
Set-Location $backendDir

python -m venv build_venv
.\build_venv\Scripts\Activate.ps1

pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
pip install --quiet pyinstaller

pyinstaller `
  --noconfirm `
  --onedir `
  --name landa_backend `
  --distpath dist `
  --workpath build `
  --specpath . `
  --add-data "models/landa-base.bin;models" `
  landa_core.py

deactivate
Write-Host "[Landa] Backend binary ready at backend\dist\landa_backend\"
