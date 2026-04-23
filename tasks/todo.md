# Replace HuggingFace Whisper with whisper.cpp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the transformers-based local Whisper transcription with whisper.cpp (via pywhispercpp) to dramatically reduce transcription latency while preserving all existing behavior.

**Architecture:** The Python backend (`backend/landa_core.py`) swaps its inference engine from HuggingFace transformers pipelines to pywhispercpp (C++ bindings for whisper.cpp). Models change from HuggingFace repos to GGML `.bin` files downloaded from `ggerganov/whisper.cpp` on HuggingFace and stored in `~/.landa/models/whisper/`. The Electron frontend adds new smaller models to the dropdown but the API contract between frontend and backend is unchanged.

**Tech Stack:** Python (pywhispercpp, httpx), whisper.cpp GGML models, Electron/Node.js frontend (unchanged API)

---

## Codebase Evaluation — Current Local Whisper System Map

### Backend (`backend/landa_core.py`)

| Symbol | Line | Role |
|---|---|---|
| `LOCAL_WHISPER_MODELS` | 807 | Set of model names that route to local inference |
| `WHISPER_HF_REPOS` | 810-813 | Maps model names to HuggingFace repo IDs |
| `_whisper_local_pipeline_cache` | 815 | Caches loaded transformers pipelines by model name |
| `_whisper_download_state` | 816 | Tracks download status per model |
| `_whisper_download_lock` | 817 | Thread lock for download state |
| `is_transformers_installed()` | 820 | Checks if `transformers` + `torch` are importable |
| `is_whisper_model_cached()` | 829 | Checks HF cache via `snapshot_download(local_files_only=True)` |
| `_do_whisper_download()` | 841 | Downloads HF repo via `snapshot_download` |
| `start_whisper_download()` | 858 | Starts download in a daemon thread |
| `transcribe_whisper_local()` | 866 | Runs transcription via transformers pipeline |
| `_warmup_whisper_pipeline()` | 900 | Pre-loads pipeline into memory at startup |
| `_startup_whisper_check()` | 922 | Auto-download + warmup on startup if local model selected |
| `transcribe()` | 1233 | Router — checks `LOCAL_WHISPER_MODELS` membership |
| `_migrate()` | 88 | Config migration — `allowed` set on line 101 |
| `/whisper-local/status` | 1410 | Reports deps installed, model cached, download state |
| `/whisper-local/install-deps` | 1444 | Streams `pip install transformers torch` via SSE |
| `/whisper-local/download` | 1476 | Triggers model download |

### Electron Frontend

| Symbol | File | Line | Role |
|---|---|---|---|
| `WHISPER_MODELS` | `renderer/settings.js` | 32-36 | Dropdown options for model selector |
| `LOCAL_WHISPER_MODELS` | `renderer/settings.js` | 576 | Set mirroring backend — controls which models show local UI |
| `updateLocalModelStatus()` | `renderer/settings.js` | 580 | Polls `/whisper-local/status` and renders UI |
| `renderLocalModelStatus()` | `renderer/settings.js` | 619 | Renders install/download/ready states |
| `installWhisperDeps()` | `renderer/settings.js` | 689 | Triggers dep install via IPC |
| IPC handlers | `main.js` | 902-947 | Bridge: `get-whisper-local-status`, `install-whisper-deps`, `download-whisper-model` |
| Preload bridge | `preload.js` | 20-25 | Exposes `getWhisperLocalStatus`, `installWhisperDeps`, `downloadWhisperModel`, `onWhisperDepsProgress` |

### Call Chain (unchanged)

```
hotkey → /start → start_recording()
hotkey → /stop → stop_recording() → _transcribe_and_paste()
  → transcribe(wav_path)
    → if model in LOCAL_WHISPER_MODELS: transcribe_whisper_local(wav_path, model)
    → elif provider == "nemo": transcribe_nemo(wav_path, language)
    → else: transcribe_openai(wav_path)
  → _is_hallucination(text)
  → post_process(text)
  → reformat_text(text)
  → add_history_entry(text)
  → paste_text(text)
```

### What MUST NOT Change

- `transcribe_openai()` — OpenAI API path (whisper-1)
- `transcribe_nemo()` — NeMo Parakeet path
- `transcribe()` router signature and behavior
- `_transcribe_and_paste()` pipeline
- `reformat_text()` / `reformat_text_local()` / all LLM-local code
- Hallucination filter, silence detection, post-processing
- Config schema keys: `openai_model`, `openai_language`, `api_provider`
- IPC handler names and signatures in `main.js` / `preload.js`
- All `/config`, `/status`, `/start`, `/stop`, `/cancel` endpoints

---

## File Changes

| Action | File | What Changes |
|---|---|---|
| **Modify** | `backend/landa_core.py:807-817` | Replace model registry constants and cache variable |
| **Modify** | `backend/landa_core.py:820-827` | Replace `is_transformers_installed()` with `is_pywhispercpp_installed()` |
| **Modify** | `backend/landa_core.py:829-838` | Replace `is_whisper_model_cached()` to check `.bin` on disk |
| **Modify** | `backend/landa_core.py:841-863` | Replace `_do_whisper_download()` with httpx streaming download |
| **Modify** | `backend/landa_core.py:866-897` | Replace `transcribe_whisper_local()` with pywhispercpp |
| **Modify** | `backend/landa_core.py:900-935` | Replace warmup and startup check functions |
| **Modify** | `backend/landa_core.py:1410-1437` | Update `/whisper-local/status` endpoint |
| **Modify** | `backend/landa_core.py:1444-1473` | Update `/whisper-local/install-deps` endpoint |
| **Modify** | `backend/landa_core.py:1476-1485` | Update `/whisper-local/download` endpoint |
| **Modify** | `backend/landa_core.py:101` | Update `_migrate()` allowed model set |
| **Modify** | `renderer/settings.js:32-36` | Add new models to `WHISPER_MODELS` dropdown |
| **Modify** | `renderer/settings.js:576` | Add new models to `LOCAL_WHISPER_MODELS` set |
| **Modify** | `renderer/settings.js:632` | Update install button size label |

---

## Task 1: Replace Model Registry and Constants

**Files:**
- Modify: `backend/landa_core.py:807-817`

- [ ] **Step 1: Replace `LOCAL_WHISPER_MODELS`, `WHISPER_HF_REPOS`, and cache variables**

Replace lines 807-817 with:

```python
LOCAL_WHISPER_MODELS = {
    "whisper-base", "whisper-small", "whisper-medium",
    "whisper-large-v3", "whisper-large-v3-turbo",
}

WHISPER_GGML_MODELS: dict[str, dict] = {
    "whisper-base": {
        "name": "Whisper Base",
        "filename": "ggml-base.bin",
        "size_label": "~148 MB",
        "size_bytes": 148_000_000,
    },
    "whisper-small": {
        "name": "Whisper Small",
        "filename": "ggml-small.bin",
        "size_label": "~488 MB",
        "size_bytes": 488_000_000,
    },
    "whisper-medium": {
        "name": "Whisper Medium",
        "filename": "ggml-medium.bin",
        "size_label": "~1.5 GB",
        "size_bytes": 1_530_000_000,
    },
    "whisper-large-v3": {
        "name": "Whisper Large V3",
        "filename": "ggml-large-v3.bin",
        "size_label": "~3.1 GB",
        "size_bytes": 3_100_000_000,
    },
    "whisper-large-v3-turbo": {
        "name": "Whisper Large V3 Turbo",
        "filename": "ggml-large-v3-turbo.bin",
        "size_label": "~1.6 GB",
        "size_bytes": 1_620_000_000,
    },
}

WHISPER_GGML_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
WHISPER_MODELS_DIR = CONFIG_DIR / "models" / "whisper"

_whisper_cpp_model_cache: dict = {}       # model_name -> pywhispercpp Model
_whisper_download_state: dict = {}        # model_name -> {downloading, cached, error, progress_bytes, total_bytes}
_whisper_download_lock = threading.Lock()
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 2: Replace Dependency Check

**Files:**
- Modify: `backend/landa_core.py:820-827`

- [ ] **Step 1: Replace `is_transformers_installed()` with `is_pywhispercpp_installed()`**

Replace:
```python
def is_transformers_installed() -> bool:
    try:
        import transformers  # noqa: F401
        import torch         # noqa: F401
        return True
    except ImportError:
        return False
```

With:
```python
def is_pywhispercpp_installed() -> bool:
    try:
        from pywhispercpp.model import Model as _WhisperModel  # noqa: F401
        return True
    except ImportError:
        return False
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 3: Replace Model Cache Check

**Files:**
- Modify: `backend/landa_core.py:829-838`

- [ ] **Step 1: Replace `is_whisper_model_cached()` to check `.bin` file on disk**

Replace:
```python
def is_whisper_model_cached(model_name: str) -> bool:
    hf_repo = WHISPER_HF_REPOS.get(model_name)
    if not hf_repo:
        return False
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(hf_repo, local_files_only=True, token=False)
        return True
    except Exception:
        return False
```

With:
```python
def is_whisper_model_cached(model_name: str) -> bool:
    info = WHISPER_GGML_MODELS.get(model_name)
    if not info:
        return False
    return (WHISPER_MODELS_DIR / info["filename"]).exists()
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 4: Replace Model Download

**Files:**
- Modify: `backend/landa_core.py:841-863`

- [ ] **Step 1: Replace `_do_whisper_download()` with httpx streaming download (matches LLM download pattern)**

Replace:
```python
def _do_whisper_download(model_name: str) -> None:
    hf_repo = WHISPER_HF_REPOS[model_name]
    with _whisper_download_lock:
        _whisper_download_state[model_name] = {"downloading": True, "cached": False, "error": None}
    try:
        from huggingface_hub import snapshot_download
        print(f"[FindMyVoice] Downloading local Whisper model: {model_name} ({hf_repo})")
        snapshot_download(hf_repo, token=False)
        with _whisper_download_lock:
            _whisper_download_state[model_name] = {"downloading": False, "cached": True, "error": None}
        print(f"[FindMyVoice] Model download complete: {model_name}")
    except Exception as e:
        with _whisper_download_lock:
            _whisper_download_state[model_name] = {"downloading": False, "cached": False, "error": str(e)}
        print(f"[FindMyVoice] Model download failed: {e}")
```

With:
```python
def _do_whisper_download(model_name: str) -> None:
    info = WHISPER_GGML_MODELS[model_name]
    with _whisper_download_lock:
        _whisper_download_state[model_name] = {
            "downloading": True, "cached": False, "error": None,
            "progress_bytes": 0, "total_bytes": info.get("size_bytes", 0),
        }
    try:
        WHISPER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        dest = WHISPER_MODELS_DIR / info["filename"]
        url = f"{WHISPER_GGML_BASE_URL}/{info['filename']}"
        print(f"[FindMyVoice] Downloading whisper.cpp model: {url}")
        with httpx.stream("GET", url, follow_redirects=True, timeout=None) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", info.get("size_bytes", 0)))
            with _whisper_download_lock:
                _whisper_download_state[model_name]["total_bytes"] = total
            downloaded = 0
            with open(dest, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    downloaded += len(chunk)
                    with _whisper_download_lock:
                        _whisper_download_state[model_name]["progress_bytes"] = downloaded

        with _whisper_download_lock:
            _whisper_download_state[model_name] = {
                "downloading": False, "cached": True, "error": None,
                "progress_bytes": 0, "total_bytes": 0,
            }
        print(f"[FindMyVoice] Model download complete: {model_name}")
    except Exception as e:
        dest = WHISPER_MODELS_DIR / info["filename"]
        if dest.exists():
            dest.unlink()
        with _whisper_download_lock:
            _whisper_download_state[model_name] = {
                "downloading": False, "cached": False, "error": str(e),
                "progress_bytes": 0, "total_bytes": 0,
            }
        print(f"[FindMyVoice] Model download failed: {e}")
```

- [ ] **Step 2: `start_whisper_download()` is unchanged** — verify it still references `_do_whisper_download` and `_whisper_download_state` correctly. No edit needed.

- [ ] **Step 3: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 5: Replace Transcription Function

**Files:**
- Modify: `backend/landa_core.py:866-897`

- [ ] **Step 1: Replace `transcribe_whisper_local()` with pywhispercpp**

Replace:
```python
def transcribe_whisper_local(wav_path: str, model_name: str) -> str:
    try:
        import torch
        from transformers import pipeline as hf_pipeline
    except ImportError:
        return "[Error] transformers/torch not installed. Please install from the Settings page."

    if model_name not in _whisper_local_pipeline_cache:
        hf_repo = WHISPER_HF_REPOS[model_name]
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        torch_dtype = torch.float16 if device == "mps" else torch.float32
        _whisper_local_pipeline_cache[model_name] = hf_pipeline(
            "automatic-speech-recognition",
            model=hf_repo,
            torch_dtype=torch_dtype,
            device=device,
        )

    pipe = _whisper_local_pipeline_cache[model_name]
    language = config.get("openai_language", "auto")

    # Always explicitly reset forced_decoder_ids so that a previous language
    # selection doesn't leak into subsequent "auto-detect" calls.  The
    # transformers Whisper pipeline may cache forced_decoder_ids on the model
    # config when a language is specified via generate_kwargs.
    if hasattr(pipe, "model") and hasattr(pipe.model, "config"):
        pipe.model.config.forced_decoder_ids = None

    generate_kwargs = {} if language == "auto" else {"language": language}

    result = pipe(wav_path, return_timestamps=True, generate_kwargs=generate_kwargs)
    return result["text"].strip()
```

With:
```python
def transcribe_whisper_local(wav_path: str, model_name: str) -> str:
    try:
        from pywhispercpp.model import Model as WhisperModel
    except ImportError:
        return "[Error] pywhispercpp not installed. Please install from the Settings page."

    if model_name not in _whisper_cpp_model_cache:
        info = WHISPER_GGML_MODELS.get(model_name)
        if not info:
            return f"[Error] Unknown local model: {model_name}"
        model_path = WHISPER_MODELS_DIR / info["filename"]
        if not model_path.exists():
            return f"[Error] Model file not found: {model_path}. Please download from Settings."
        _whisper_cpp_model_cache[model_name] = WhisperModel(str(model_path))

    model = _whisper_cpp_model_cache[model_name]
    language = config.get("openai_language", "auto")

    kwargs = {}
    if language and language != "auto":
        kwargs["language"] = language

    segments = model.transcribe(wav_path, **kwargs)
    return " ".join(seg.text for seg in segments).strip()
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 6: Replace Warmup and Startup Functions

**Files:**
- Modify: `backend/landa_core.py:900-935`

- [ ] **Step 1: Replace `_warmup_whisper_pipeline()`**

Replace:
```python
def _warmup_whisper_pipeline(model_name: str) -> None:
    """Load the Whisper pipeline into memory so first transcription is instant."""
    if model_name in _whisper_local_pipeline_cache:
        return
    try:
        import torch
        from transformers import pipeline as hf_pipeline
        hf_repo = WHISPER_HF_REPOS[model_name]
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        torch_dtype = torch.float16 if device == "mps" else torch.float32
        print(f"[FindMyVoice] Warming up Whisper pipeline: {model_name} on {device}...")
        _whisper_local_pipeline_cache[model_name] = hf_pipeline(
            "automatic-speech-recognition",
            model=hf_repo,
            torch_dtype=torch_dtype,
            device=device,
        )
        print(f"[FindMyVoice] Whisper pipeline ready: {model_name}")
    except Exception as e:
        print(f"[FindMyVoice] Pipeline warmup failed: {e}")
```

With:
```python
def _warmup_whisper_pipeline(model_name: str) -> None:
    """Load the whisper.cpp model into memory so first transcription is instant."""
    if model_name in _whisper_cpp_model_cache:
        return
    try:
        from pywhispercpp.model import Model as WhisperModel
        info = WHISPER_GGML_MODELS.get(model_name)
        if not info:
            return
        model_path = WHISPER_MODELS_DIR / info["filename"]
        if not model_path.exists():
            return
        print(f"[FindMyVoice] Loading whisper.cpp model: {model_name}...")
        _whisper_cpp_model_cache[model_name] = WhisperModel(str(model_path))
        print(f"[FindMyVoice] whisper.cpp model ready: {model_name}")
    except Exception as e:
        print(f"[FindMyVoice] Model warmup failed: {e}")
```

- [ ] **Step 2: Replace `_startup_whisper_check()`**

Replace:
```python
def _startup_whisper_check() -> None:
    """Auto-download and warm up the selected local Whisper model on startup."""
    model = config.get("openai_model", "whisper-1")
    if model not in LOCAL_WHISPER_MODELS:
        return
    if not is_transformers_installed():
        print(f"[FindMyVoice] Local model '{model}' selected but transformers/torch not installed.")
        return
    if not is_whisper_model_cached(model):
        print(f"[FindMyVoice] Auto-downloading model '{model}' in background...")
        _do_whisper_download(model)  # block until downloaded, then warm up below
    with _whisper_download_lock:
        _whisper_download_state[model] = {"downloading": False, "cached": True, "error": None}
    _warmup_whisper_pipeline(model)
```

With:
```python
def _startup_whisper_check() -> None:
    """Auto-download and warm up the selected local Whisper model on startup."""
    model = config.get("openai_model", "whisper-1")
    if model not in LOCAL_WHISPER_MODELS:
        return
    if not is_pywhispercpp_installed():
        print(f"[FindMyVoice] Local model '{model}' selected but pywhispercpp not installed.")
        return
    if not is_whisper_model_cached(model):
        print(f"[FindMyVoice] Auto-downloading model '{model}' in background...")
        _do_whisper_download(model)  # block until downloaded, then warm up below
    with _whisper_download_lock:
        _whisper_download_state[model] = {
            "downloading": False, "cached": True, "error": None,
            "progress_bytes": 0, "total_bytes": 0,
        }
    _warmup_whisper_pipeline(model)
```

- [ ] **Step 3: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 7: Update `/whisper-local/status` Endpoint

**Files:**
- Modify: `backend/landa_core.py:1410-1437`

- [ ] **Step 1: Replace the status endpoint to use `is_pywhispercpp_installed()` and report progress**

Replace:
```python
@app.get("/whisper-local/status")
def whisper_local_status():
    model_name = request.args.get("model") or config.get("openai_model", "whisper-1")
    if model_name not in LOCAL_WHISPER_MODELS:
        return jsonify({"model": model_name, "is_local": False})

    deps_installed = is_transformers_installed()
    with _whisper_download_lock:
        state = dict(_whisper_download_state.get(model_name, {}))

    downloading = state.get("downloading", False)
    cached = state.get("cached", False)
    error = state.get("error")

    # If no state yet, check the HF cache on disk
    if not state and deps_installed and not downloading:
        cached = is_whisper_model_cached(model_name)
        with _whisper_download_lock:
            _whisper_download_state[model_name] = {"downloading": False, "cached": cached, "error": None}

    return jsonify({
        "model": model_name,
        "is_local": True,
        "deps_installed": deps_installed,
        "cached": cached,
        "downloading": downloading,
        "error": error,
    })
```

With:
```python
@app.get("/whisper-local/status")
def whisper_local_status():
    model_name = request.args.get("model") or config.get("openai_model", "whisper-1")
    if model_name not in LOCAL_WHISPER_MODELS:
        return jsonify({"model": model_name, "is_local": False})

    deps_installed = is_pywhispercpp_installed()
    with _whisper_download_lock:
        state = dict(_whisper_download_state.get(model_name, {}))

    downloading = state.get("downloading", False)
    cached = state.get("cached", False)
    error = state.get("error")
    progress_bytes = state.get("progress_bytes", 0)
    total_bytes = state.get("total_bytes", 0)

    # If no state yet, check disk
    if not state and not downloading:
        cached = is_whisper_model_cached(model_name)
        with _whisper_download_lock:
            _whisper_download_state[model_name] = {
                "downloading": False, "cached": cached, "error": None,
                "progress_bytes": 0, "total_bytes": 0,
            }

    return jsonify({
        "model": model_name,
        "is_local": True,
        "deps_installed": deps_installed,
        "cached": cached,
        "downloading": downloading,
        "error": error,
        "progress_bytes": progress_bytes,
        "total_bytes": total_bytes,
    })
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 8: Update `/whisper-local/install-deps` Endpoint

**Files:**
- Modify: `backend/landa_core.py:1444-1473`

- [ ] **Step 1: Change pip install command from `transformers torch` to `pywhispercpp`**

Replace:
```python
            proc = subprocess.Popen(
                [python, "-m", "pip", "install", "transformers", "torch"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
```

With:
```python
            proc = subprocess.Popen(
                [python, "-m", "pip", "install", "pywhispercpp"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 9: Update `/whisper-local/download` Endpoint

**Files:**
- Modify: `backend/landa_core.py:1476-1485`

- [ ] **Step 1: Change dependency check from `is_transformers_installed()` to `is_pywhispercpp_installed()`**

Replace:
```python
@app.post("/whisper-local/download")
def whisper_local_download():
    data = request.get_json(force=True)
    model_name = data.get("model") or config.get("openai_model", "whisper-1")
    if model_name not in LOCAL_WHISPER_MODELS:
        return jsonify({"error": "not a local model"}), 400
    if not is_transformers_installed():
        return jsonify({"error": "transformers/torch not installed"}), 400
    start_whisper_download(model_name)
    return jsonify({"started": True})
```

With:
```python
@app.post("/whisper-local/download")
def whisper_local_download():
    data = request.get_json(force=True)
    model_name = data.get("model") or config.get("openai_model", "whisper-1")
    if model_name not in LOCAL_WHISPER_MODELS:
        return jsonify({"error": "not a local model"}), 400
    if not is_pywhispercpp_installed():
        return jsonify({"error": "pywhispercpp not installed"}), 400
    start_whisper_download(model_name)
    return jsonify({"started": True})
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 10: Update Migration Function

**Files:**
- Modify: `backend/landa_core.py:101`

- [ ] **Step 1: Expand the allowed model set in `_migrate()`**

Replace:
```python
            allowed = {"whisper-1", "whisper-large-v3", "whisper-large-v3-turbo"}
```

With:
```python
            allowed = {"whisper-1", "whisper-base", "whisper-small", "whisper-medium", "whisper-large-v3", "whisper-large-v3-turbo"}
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

---

## Task 11: Update Frontend — Model Lists and UI

**Files:**
- Modify: `renderer/settings.js:32-36`
- Modify: `renderer/settings.js:576`
- Modify: `renderer/settings.js:632`

- [ ] **Step 1: Update `WHISPER_MODELS` dropdown with new models (ordered by quality/size)**

Replace:
```javascript
const WHISPER_MODELS = [
  { value: 'whisper-large-v3', label: 'whisper-large-v3', logo: 'openai' },
  { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo', logo: 'openai' },
  { value: 'whisper-1', label: 'whisper-1', logo: 'openai' },
  { value: 'nemo', label: 'NeMo Parakeet', logo: 'nvidia' },
];
```

With:
```javascript
const WHISPER_MODELS = [
  { value: 'whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo', logo: 'openai' },
  { value: 'whisper-large-v3', label: 'Whisper Large V3', logo: 'openai' },
  { value: 'whisper-medium', label: 'Whisper Medium', logo: 'openai' },
  { value: 'whisper-small', label: 'Whisper Small', logo: 'openai' },
  { value: 'whisper-base', label: 'Whisper Base', logo: 'openai' },
  { value: 'whisper-1', label: 'whisper-1 (API)', logo: 'openai' },
  { value: 'nemo', label: 'NeMo Parakeet', logo: 'nvidia' },
];
```

- [ ] **Step 2: Update `LOCAL_WHISPER_MODELS` set to include new models**

Replace:
```javascript
const LOCAL_WHISPER_MODELS = new Set(['whisper-large-v3', 'whisper-large-v3-turbo']);
```

With:
```javascript
const LOCAL_WHISPER_MODELS = new Set([
  'whisper-large-v3-turbo', 'whisper-large-v3', 'whisper-medium', 'whisper-small', 'whisper-base',
]);
```

- [ ] **Step 3: Update install button size label (pywhispercpp is much smaller than transformers+torch)**

Replace:
```javascript
        <button class="btn-local-model" id="btn-install-whisper-deps">Install (~2 GB)</button>
```

With:
```javascript
        <button class="btn-local-model" id="btn-install-whisper-deps">Install</button>
```

- [ ] **Step 4: Verify no JS syntax errors**

Run: `node -c /Users/bricks/Developer/FinyMyVoice/electron-app/renderer/settings.js`
Expected: no output (success)

---

## Task 12: Full Verification

- [ ] **Step 1: Verify Python file parses correctly**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && python -c "import ast; ast.parse(open('backend/landa_core.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 2: Verify JS file parses correctly**

Run: `node -c /Users/bricks/Developer/FinyMyVoice/electron-app/renderer/settings.js`
Expected: no output (success)

- [ ] **Step 3: Verify no stale references to `transformers`, `torch`, `WHISPER_HF_REPOS`, or `_whisper_local_pipeline_cache` remain in landa_core.py**

Run: `grep -n "transformers\|WHISPER_HF_REPOS\|_whisper_local_pipeline_cache\|is_transformers_installed" backend/landa_core.py`
Expected: no output (no matches)

- [ ] **Step 4: Start the backend and verify it boots without import errors**

Run: `cd /Users/bricks/Developer/FinyMyVoice/electron-app && timeout 5 python backend/landa_core.py 2>&1 || true`
Expected: Flask server starts (pywhispercpp may not be installed yet, but no import errors at module level — pywhispercpp is only imported inside functions)

- [ ] **Step 5: Start Electron app and verify settings UI loads**

Run: `npm start` (manual verification)
Expected: Settings page loads, model dropdown shows all 7 options, selecting a local model shows the local model status UI

- [ ] **Step 6: End-to-end test (manual, after installing pywhispercpp and downloading a model)**

1. Select `whisper-large-v3-turbo` in settings
2. Click "Install" to install pywhispercpp
3. Click "Download" to download the GGML model
4. Status shows "Ready"
5. Use hotkey to record, stop, verify transcription + paste works
6. Switch to `whisper-1` — verify OpenAI API transcription still works
7. Switch to `nemo` — verify NeMo path still works (if installed)

---

## Review

### Acceptance Criteria Checklist

- [ ] `pip install pywhispercpp` succeeds via `/whisper-local/install-deps`
- [ ] Model `.bin` files download correctly via `/whisper-local/download`
- [ ] `/whisper-local/status` correctly reports deps installed + model cached state
- [ ] `transcribe_whisper_local()` uses whisper.cpp and produces correct transcriptions
- [ ] Model is pre-loaded at startup (no cold-start on first transcription)
- [ ] Language selection works (specific language + auto-detect)
- [ ] OpenAI API transcription (`whisper-1`) still works unchanged
- [ ] NeMo transcription still works unchanged
- [ ] Local LLM reformat system is untouched and still works
- [ ] Full flow: hotkey -> record -> stop -> transcribe (local) -> paste
- [ ] No regressions in `/config`, `/status`, `/start`, `/stop`, `/cancel`
- [ ] Works on macOS (Metal acceleration). Windows path exists and is reasonable.
