"""FindMyVoice — lightweight voice-to-text backend.

Records from the default mic, transcribes via OpenAI Whisper API or NVIDIA
NeMo Parakeet (local), and pastes the result into the active app.  Exposes a
local HTTP API on localhost:7890 for the SwiftUI frontend.  Hotkey listening is
handled by the Swift app.
"""

import datetime
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import sounddevice as sd
from flask import Flask, Response, jsonify, request
from scipy.io import wavfile
from openai import OpenAI

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CONFIG_DIR = Path.home() / ".findmyvoice"
CONFIG_PATH = CONFIG_DIR / "config.json"
HISTORY_PATH = CONFIG_DIR / "history.json"

DEFAULT_CONFIG: dict = {
    "api_key": "",
    "api_provider": "openai",
    "openai_model": "whisper-large-v3",
    "openai_language": "auto",
    "nemo_language": "auto",
    "sound_start": "Tink",
    "sound_stop": "Pop",
    "auto_paste": True,
    "auto_capitalize": True,
    "auto_punctuate": True,
    "toggle_recording": {"key": "f5", "key_code": 96, "modifiers": ["command", "shift"]},
    "cancel_recording": {"key": "escape", "key_code": 53, "modifiers": []},
    "change_mode": {"key": "k", "key_code": 40, "modifiers": ["option", "shift"]},
    "push_to_talk": {"key": "", "key_code": -1, "modifiers": []},
    "mouse_shortcut": {"key": "", "key_code": -1, "modifiers": []},
    "reformat_enabled": False,
    "reformat_mode": "default",
    "llm_provider": "openai",
    "llm_api_key": "",
    "llm_model": "",
    "modes": {
        "selections": {
            "personal-message": "formal",
            "email": "formal",
        },
        "categories": {
            "email": {
                "linkedApps": ["Mail", "Outlook", "Superhuman"],
                "linkedUrls": ["mail.google.com", "outlook.live.com", "outlook.office.com"],
            },
            "personal-message": {
                "linkedApps": ["Slack", "Discord", "WhatsApp", "Telegram", "Signal"],
                "linkedUrls": [],
            },
        },
    },
}


def _migrate(cfg: dict) -> tuple[dict, bool]:
    """Migrate old config schema to new schema. Returns (cfg, changed)."""
    changed = False

    # provider: "custom" → "openai"
    if cfg.get("api_provider") == "custom":
        cfg["api_provider"] = "openai"
        changed = True

    # old "model" → "openai_model"
    if "model" in cfg:
        old_model = cfg.pop("model")
        if "openai_model" not in cfg:
            allowed = {"whisper-1", "whisper-large-v3", "whisper-large-v3-turbo"}
            cfg["openai_model"] = old_model if old_model in allowed else "whisper-1"
        changed = True

    # old "language" → "openai_language"
    if "language" in cfg:
        old_lang = cfg.pop("language")
        if "openai_language" not in cfg:
            cfg["openai_language"] = old_lang
        cfg.setdefault("nemo_language", "auto")
        changed = True

    # migrate old "hotkey" → "toggle_recording"
    if "hotkey" in cfg and "toggle_recording" not in cfg:
        old_hk = cfg.pop("hotkey")
        if old_hk:
            cfg["toggle_recording"] = {"key": old_hk, "modifiers": []}
        changed = True
    elif "hotkey" in cfg:
        cfg.pop("hotkey")
        changed = True

    # remove obsolete fields
    for field in ("api_base_url",):
        if field in cfg:
            cfg.pop(field)
            changed = True

    # ensure modes config exists
    if "modes" not in cfg:
        cfg["modes"] = {"selections": {"personal-message": "formal", "email": "formal"}}
        changed = True
    elif "selections" not in cfg["modes"]:
        cfg["modes"]["selections"] = {"personal-message": "formal", "email": "formal"}
        changed = True
    else:
        sels = cfg["modes"]["selections"]
        if "personal-message" not in sels:
            sels["personal-message"] = "formal"
            changed = True
        if "email" not in sels:
            sels["email"] = "formal"
            changed = True

    # ensure categories config exists with defaults
    modes = cfg.setdefault("modes", {})
    if "categories" not in modes:
        modes["categories"] = {
            "email": {
                "linkedApps": ["Mail", "Outlook", "Superhuman"],
                "linkedUrls": ["mail.google.com", "outlook.live.com", "outlook.office.com"],
            },
            "personal-message": {
                "linkedApps": ["Slack", "Discord", "WhatsApp", "Telegram", "Signal"],
                "linkedUrls": [],
            },
        }
        changed = True
    else:
        cats = modes["categories"]
        if "email" not in cats:
            cats["email"] = {"linkedApps": ["Mail", "Outlook", "Superhuman"], "linkedUrls": ["mail.google.com", "outlook.live.com", "outlook.office.com"]}
            changed = True
        if "personal-message" not in cats:
            cats["personal-message"] = {"linkedApps": ["Slack", "Discord", "WhatsApp", "Telegram", "Signal"], "linkedUrls": []}
            changed = True

    # ensure llm fields exist
    if "llm_provider" not in cfg:
        cfg["llm_provider"] = "openai"
        changed = True
    if "llm_api_key" not in cfg:
        cfg["llm_api_key"] = ""
        changed = True
    if "llm_model" not in cfg:
        cfg["llm_model"] = ""
        changed = True

    return cfg, changed


def load_config() -> dict:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            saved = json.load(f)
        saved, changed = _migrate(saved)
        merged = {**DEFAULT_CONFIG, **saved}
        if changed:
            save_config(merged)
        return merged
    save_config(DEFAULT_CONFIG)
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


config = load_config()

# ---------------------------------------------------------------------------
# Transcription History
# ---------------------------------------------------------------------------

_history_lock = threading.Lock()


def _load_history() -> list:
    if HISTORY_PATH.exists():
        try:
            with open(HISTORY_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _save_history(entries: list) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_PATH, "w") as f:
        json.dump(entries, f, indent=2)


def add_history_entry(text: str) -> None:
    entry = {
        "id": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "text": text,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    with _history_lock:
        entries = _load_history()
        entries.insert(0, entry)
        _save_history(entries)


# ---------------------------------------------------------------------------
# Reformat prompts (2 categories × 3 styles)
# ---------------------------------------------------------------------------

MODE_SYSTEM_PROMPTS: dict[str, dict[str, str]] = {
    "personal-message": {
        "formal": (
            "Reformat the following dictated text into a personal message. "
            "Use proper capitalization and full punctuation. Keep it direct and concise — "
            "no greeting or sign-off needed. Fix grammar and remove filler words. "
            "Do not add content that wasn't spoken. Return only the message text."
        ),
        "casual": (
            "Reformat the following dictated text into a casual personal message. "
            "Use capitalization but relaxed punctuation — skip periods at the end of sentences where it feels natural. "
            "Keep it short and conversational. No greeting or sign-off. Fix filler words. "
            "Do not add content that wasn't spoken. Return only the message text."
        ),
        "excited": (
            "Reformat the following dictated text into an enthusiastic personal message. "
            "Use exclamation marks to convey energy and excitement. Keep it short, warm, and upbeat. "
            "No greeting or sign-off needed. Fix grammar and filler words. "
            "Do not add content that wasn't spoken. Return only the message text."
        ),
    },
    "email": {
        "formal": (
            "Reformat the following dictated text into a professional email body. "
            "Use proper capitalization, full punctuation, and formal tone. Structure into clear paragraphs. "
            "Include an appropriate greeting and sign-off (e.g. 'Best regards,'). "
            "Fix grammar and remove filler words. Do not add content that wasn't spoken. "
            "Do not include a subject line. Return only the email body."
        ),
        "casual": (
            "Reformat the following dictated text into a casual but professional email body. "
            "Use capitalization but lighter punctuation. Keep sentences flowing naturally. "
            "Include a friendly greeting and casual sign-off. Fix grammar and filler words. "
            "Do not add content that wasn't spoken. Do not include a subject line. "
            "Return only the email body."
        ),
        "excited": (
            "Reformat the following dictated text into an enthusiastic email body. "
            "Use exclamation marks to convey energy and positivity. "
            "Keep the tone warm, upbeat, and professional. Include a greeting and sign-off. "
            "Fix grammar and filler words. Do not add content that wasn't spoken. "
            "Do not include a subject line. Return only the email body."
        ),
    },
}

# Legacy prompts for backward compatibility with old reformat_mode config
REFORMAT_PROMPTS: dict[str, str] = {
    "default": (
        "Clean up the following dictated text. "
        "Remove filler words (um, uh, like), fix grammar and punctuation. "
        "Keep the original tone and meaning. Return only the cleaned text."
    ),
    "email": MODE_SYSTEM_PROMPTS["email"]["formal"],
    "slack": (
        "Reformat the following dictated text into a casual Slack message. "
        "Keep it concise and conversational. Use short sentences. "
        "Fix filler words and grammar but keep the tone informal. "
        "Lowercase is fine. Return only the message."
    ),
}


def detect_active_app() -> tuple[str, str]:
    """Return (app_name, url) of the frontmost app via AppleScript (macOS only).

    For browsers, also retrieves the URL of the active tab.
    """
    if sys.platform != "darwin":
        return ("", "")
    app_name = ""
    url = ""
    try:
        result = subprocess.run(
            ["osascript", "-e",
             'tell application "System Events" to get name of first application process whose frontmost is true'],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode == 0:
            app_name = result.stdout.strip()
    except Exception:
        pass

    # Try to get browser URL for common browsers
    browsers = {
        "Google Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
        "Safari": 'tell application "Safari" to get URL of front document',
        "Arc": 'tell application "Arc" to get URL of active tab of front window',
        "Microsoft Edge": 'tell application "Microsoft Edge" to get URL of active tab of front window',
        "Brave Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
        "Firefox": 'tell application "Firefox" to get URL of active tab of front window',
    }
    if app_name in browsers:
        try:
            result = subprocess.run(
                ["osascript", "-e", browsers[app_name]],
                capture_output=True, text=True, timeout=2,
            )
            if result.returncode == 0:
                url = result.stdout.strip()
        except Exception:
            pass

    return (app_name, url)


def is_category_enabled(cat_id: str) -> bool:
    """Return False only if the category has been explicitly disabled."""
    return config.get("modes", {}).get("enabled", {}).get(cat_id, True)


def get_active_category() -> str | None:
    """Determine mode category from the frontmost app using configurable linked apps/URLs.
    Returns None if no enabled category matches."""
    app_name, url = detect_active_app()
    app_name_lower = app_name.lower()
    url_lower = url.lower()

    categories = config.get("modes", {}).get("categories", {})

    for cat_id, cat_cfg in categories.items():
        if not is_category_enabled(cat_id):
            continue

        linked_apps = cat_cfg.get("linkedApps", [])
        linked_urls = cat_cfg.get("linkedUrls", [])

        # Check app name (case-insensitive partial match)
        for linked_app in linked_apps:
            if linked_app.lower() in app_name_lower:
                return cat_id

        # Check URL (substring match)
        if url_lower:
            for linked_url in linked_urls:
                if linked_url.lower() in url_lower:
                    return cat_id

    return None


def get_mode_prompt() -> str | None:
    """Get the system prompt for the current active app + selected style.
    Returns None if the active category is disabled (raw transcription)."""
    category = get_active_category()
    if category is None:
        return None
    selections = config.get("modes", {}).get("selections", {})
    style = selections.get(category, "formal")
    return MODE_SYSTEM_PROMPTS.get(category, MODE_SYSTEM_PROMPTS["personal-message"]).get(
        style, MODE_SYSTEM_PROMPTS["personal-message"]["formal"]
    )


def reformat_text(text: str, mode: str | None = None) -> str:
    """Post-process transcription via configured LLM. Falls back to original text on any error."""
    llm_provider = config.get("llm_provider", "openai")
    # Use dedicated LLM key; fall back to transcription key when both providers are openai
    api_key = config.get("llm_api_key", "") or (
        config.get("api_key", "") if llm_provider == "openai" else ""
    )
    if not api_key:
        return text

    llm_model = config.get("llm_model", "") or (
        "gpt-4o-mini" if llm_provider == "openai" else "claude-haiku-4-5-20251001"
    )

    if mode and mode in REFORMAT_PROMPTS:
        prompt = REFORMAT_PROMPTS[mode]
    else:
        prompt = get_mode_prompt()
        if prompt is None:
            return text

    try:
        if llm_provider == "anthropic":
            try:
                import anthropic
            except ImportError:
                print("[FindMyVoice] Anthropic SDK not installed. Run: pip install anthropic")
                return text
            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=llm_model,
                max_tokens=1024,
                system=prompt,
                messages=[{"role": "user", "content": text}],
            )
            return response.content[0].text.strip()
        else:
            client = OpenAI(api_key=api_key, timeout=httpx.Timeout(3.0))
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text},
                ],
            )
            return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[FindMyVoice] Reformat error (falling back to raw text): {e}")
        return text


# ---------------------------------------------------------------------------
# Audio recording state
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16000
recording = False
audio_frames: list[np.ndarray] = []
stream: sd.InputStream | None = None
lock = threading.Lock()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def play_sound(name: str) -> None:
    """Play a system sound by name (non-blocking)."""
    if sys.platform == "darwin":
        path = f"/System/Library/Sounds/{name}.aiff"
        if os.path.exists(path):
            subprocess.Popen(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif sys.platform == "win32":
        try:
            import winsound
            winsound.PlaySound("SystemDefault", winsound.SND_ALIAS | winsound.SND_ASYNC)
        except Exception:
            pass


def paste_text(text: str) -> None:
    """Copy *text* to the clipboard and simulate the OS paste shortcut."""
    if sys.platform == "darwin":
        process = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        process.communicate(text.encode("utf-8"))

        time.sleep(0.05)  # brief pause to ensure clipboard is ready

        result = subprocess.run(
            [
                "osascript",
                "-e",
                'tell application "System Events" to keystroke "v" using command down',
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            logging.error("Auto-paste failed (osascript exit %d): %s", result.returncode, result.stderr.strip())
            logging.error("Ensure FindMyVoice has Accessibility permission in System Settings → Privacy & Security → Accessibility")
    elif sys.platform == "win32":
        try:
            import ctypes
            import ctypes.wintypes

            # Write text to clipboard via Win32 API
            CF_UNICODETEXT = 13
            ctypes.windll.user32.OpenClipboard(0)
            ctypes.windll.user32.EmptyClipboard()
            encoded = text.encode("utf-16-le") + b"\x00\x00"
            hglob = ctypes.windll.kernel32.GlobalAlloc(0x0002, len(encoded))  # GMEM_MOVEABLE
            ptr = ctypes.windll.kernel32.GlobalLock(hglob)
            ctypes.memmove(ptr, encoded, len(encoded))
            ctypes.windll.kernel32.GlobalUnlock(hglob)
            ctypes.windll.user32.SetClipboardData(CF_UNICODETEXT, hglob)
            ctypes.windll.user32.CloseClipboard()

            time.sleep(0.05)

            # Simulate Ctrl+V via SendInput
            INPUT_KEYBOARD = 1
            KEYEVENTF_KEYUP = 0x0002
            VK_CONTROL = 0x11
            VK_V = 0x56

            class KEYBDINPUT(ctypes.Structure):
                _fields_ = [
                    ("wVk", ctypes.wintypes.WORD),
                    ("wScan", ctypes.wintypes.WORD),
                    ("dwFlags", ctypes.wintypes.DWORD),
                    ("time", ctypes.wintypes.DWORD),
                    ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
                ]

            class INPUT(ctypes.Structure):
                class _INPUT(ctypes.Union):
                    _fields_ = [("ki", KEYBDINPUT)]
                _anonymous_ = ("_input",)
                _fields_ = [("type", ctypes.wintypes.DWORD), ("_input", _INPUT)]

            def make_key(vk, flags=0):
                i = INPUT()
                i.type = INPUT_KEYBOARD
                i.ki.wVk = vk
                i.ki.dwFlags = flags
                return i

            inputs = (INPUT * 4)(
                make_key(VK_CONTROL),
                make_key(VK_V),
                make_key(VK_V, KEYEVENTF_KEYUP),
                make_key(VK_CONTROL, KEYEVENTF_KEYUP),
            )
            ctypes.windll.user32.SendInput(4, inputs, ctypes.sizeof(INPUT))
        except Exception as e:
            logging.error("Auto-paste failed on Windows: %s", e)


# Known Whisper hallucination phrases produced on silence / background noise
_HALLUCINATION_PHRASES = {
    "thank you for watching",
    "thanks for watching",
    "thank you for listening",
    "thanks for listening",
    "subscribe",
    "please subscribe",
    "like and subscribe",
    "see you next time",
    "see you in the next video",
    "bye",
    "goodbye",
    "the end",
    "you",
    "thank you",
    "thanks",
    "subtitles by",
    "amara.org",
    "translated by",
    "...",
    ".",
}

# Minimum RMS energy threshold — below this the audio is considered silence
_SILENCE_RMS_THRESHOLD = 0.005


def _is_silent(audio: np.ndarray) -> bool:
    """Return True if the recorded audio is effectively silence."""
    rms = np.sqrt(np.mean(audio ** 2))
    logging.info("[silence_check] RMS energy: %.6f (threshold: %.6f)", rms, _SILENCE_RMS_THRESHOLD)
    return rms < _SILENCE_RMS_THRESHOLD


def _is_hallucination(text: str) -> bool:
    """Return True if the transcription looks like a Whisper hallucination."""
    cleaned = text.strip().rstrip(".!?,").strip().lower()
    if cleaned in _HALLUCINATION_PHRASES:
        logging.info("[hallucination_filter] Rejected: %r", text)
        return True
    return False


def post_process(text: str) -> str:
    """Apply auto-capitalize and auto-punctuate."""
    if not text:
        return text
    if config.get("auto_capitalize", True):
        text = text[0].upper() + text[1:]
    if config.get("auto_punctuate", True):
        if text[-1] not in ".!?,:;":
            text += "."
    return text


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------


def _audio_callback(indata: np.ndarray, frames: int, time_info, status) -> None:
    audio_frames.append(indata.copy())


def start_recording() -> bool:
    global recording, stream, audio_frames
    t0 = time.time()
    logging.info("[start_recording] called")
    with lock:
        if recording:
            logging.info("[start_recording] already recording, returning False")
            return False
        audio_frames = []
        t1 = time.time()
        logging.info("[start_recording] creating InputStream... (%.3fs since entry)", time.time() - t0)
        try:
            stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                callback=_audio_callback,
            )
        except Exception as e:
            logging.error("[start_recording] InputStream creation failed after %.3fs: %s", time.time() - t1, e)
            raise
        t2 = time.time()
        logging.info("[start_recording] InputStream created in %.3fs, starting stream...", t2 - t1)
        try:
            stream.start()
        except Exception as e:
            logging.error("[start_recording] stream.start() failed after %.3fs: %s", time.time() - t2, e)
            raise
        t3 = time.time()
        logging.info("[start_recording] stream started in %.3fs", t3 - t2)
        recording = True
    play_sound(config.get("sound_start", "Tink"))
    logging.info("[start_recording] done in %.3fs total", time.time() - t0)
    return True


def stop_recording() -> bool:
    global recording, stream
    t0 = time.time()
    logging.info("[stop_recording] called")
    old_stream = None
    with lock:
        if not recording:
            logging.info("[stop_recording] not recording, returning False")
            return False
        old_stream = stream
        stream = None
        recording = False
    logging.info("[stop_recording] state updated in %.3fs", time.time() - t0)
    # Tear down PortAudio synchronously so the stream is fully released before
    # the next start_recording call.  abort()+close() can block on macOS
    # CoreAudio, but doing this in a background thread caused PortAudio
    # deadlocks when a new InputStream was created before teardown finished.
    if old_stream is not None:
        t1 = time.time()
        try:
            old_stream.abort()
            old_stream.close()
            logging.info("[stop_recording] stream teardown completed in %.3fs", time.time() - t1)
        except Exception as e:
            logging.error("[stop_recording] stream teardown failed after %.3fs: %s", time.time() - t1, e)
    play_sound(config.get("sound_stop", "Pop"))
    threading.Thread(target=_transcribe_and_paste, daemon=True).start()
    logging.info("[stop_recording] done in %.3fs total", time.time() - t0)
    return True


def cancel_recording() -> bool:
    """Stop recording and discard audio — no transcription or paste."""
    global recording, stream, audio_frames
    t0 = time.time()
    logging.info("[cancel_recording] called")
    old_stream = None
    with lock:
        if not recording:
            logging.info("[cancel_recording] not recording, returning False")
            return False
        old_stream = stream
        stream = None
        recording = False
        audio_frames = []
    logging.info("[cancel_recording] state updated in %.3fs", time.time() - t0)
    if old_stream is not None:
        t1 = time.time()
        try:
            old_stream.abort()
            old_stream.close()
            logging.info("[cancel_recording] stream teardown completed in %.3fs", time.time() - t1)
        except Exception as e:
            logging.error("[cancel_recording] stream teardown failed after %.3fs: %s", time.time() - t1, e)
    logging.info("[cancel_recording] done in %.3fs total — audio discarded", time.time() - t0)
    return True


def _transcribe_and_paste() -> None:
    if not audio_frames:
        return

    # Write wav to a temp file
    audio = np.concatenate(audio_frames, axis=0)

    # Skip transcription entirely if the audio is silence
    if _is_silent(audio):
        logging.info("[transcribe] Skipping — audio is silence")
        return

    audio_int16 = np.int16(audio * 32767)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    wavfile.write(tmp.name, SAMPLE_RATE, audio_int16)
    tmp.close()

    try:
        text = transcribe(tmp.name)
        # Filter out Whisper hallucinations before any processing
        if not text or _is_hallucination(text):
            return
        text = post_process(text)
        if text:
            text = reformat_text(text)
        if text:
            add_history_entry(text)
        if text and config.get("auto_paste", True):
            paste_text(text)
    finally:
        os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Local Whisper (transformers + torch via HuggingFace)
# ---------------------------------------------------------------------------

LOCAL_WHISPER_MODELS = {"whisper-large-v3", "whisper-large-v3-turbo"}

# Official HuggingFace repo IDs (transformers-compatible)
WHISPER_HF_REPOS = {
    "whisper-large-v3": "openai/whisper-large-v3",
    "whisper-large-v3-turbo": "openai/whisper-large-v3-turbo",
}

_whisper_local_pipeline_cache: dict = {}  # model_name -> transformers pipeline
_whisper_download_state: dict = {}        # model_name -> {downloading, cached, error}
_whisper_download_lock = threading.Lock()


def is_transformers_installed() -> bool:
    try:
        import transformers  # noqa: F401
        import torch         # noqa: F401
        return True
    except ImportError:
        return False


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


def start_whisper_download(model_name: str) -> None:
    with _whisper_download_lock:
        state = _whisper_download_state.get(model_name, {})
        if state.get("downloading"):
            return  # already in progress
    threading.Thread(target=_do_whisper_download, args=(model_name,), daemon=True).start()


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
    generate_kwargs = {} if language == "auto" else {"language": language}

    result = pipe(wav_path, chunk_length_s=30, generate_kwargs=generate_kwargs)
    return result["text"].strip()


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


_nemo_model = None


def _warmup_nemo() -> None:
    """Load the NeMo Parakeet model into memory so first transcription is instant."""
    global _nemo_model
    if _nemo_model is not None:
        return
    try:
        import nemo.collections.asr as nemo_asr
        print("[FindMyVoice] Warming up NeMo Parakeet model...")
        _nemo_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
        print("[FindMyVoice] NeMo model ready.")
    except ImportError:
        pass  # NeMo not installed, skip silently
    except Exception as e:
        print(f"[FindMyVoice] NeMo warmup failed: {e}")


def _startup_nemo_check() -> None:
    """Warm up NeMo Parakeet model at startup if it's the selected provider."""
    if config.get("api_provider") == "nemo":
        _warmup_nemo()


threading.Thread(target=_startup_whisper_check, daemon=True).start()
threading.Thread(target=_startup_nemo_check, daemon=True).start()


def transcribe_nemo(audio_path: str, language: str) -> str:
    global _nemo_model
    try:
        import nemo.collections.asr as nemo_asr
    except ImportError:
        return "[Error] NeMo is not installed. Run: pip install nemo_toolkit['asr']"

    if _nemo_model is None:
        _nemo_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")

    output = _nemo_model.transcribe([audio_path])
    return output[0].text


def transcribe_openai(wav_path: str) -> str:
    api_key = config.get("api_key", "")
    if not api_key:
        print("[FindMyVoice] No API key configured.")
        return ""

    client = OpenAI(api_key=api_key)

    language = config.get("openai_language", "auto")

    try:
        with open(wav_path, "rb") as f:
            kwargs: dict = {"model": config.get("openai_model", "whisper-1"), "file": f}
            if language and language != "auto":
                kwargs["language"] = language
            transcript = client.audio.transcriptions.create(**kwargs)
        return transcript.text.strip()
    except Exception as e:
        print(f"[FindMyVoice] Transcription error: {e}")
        return ""


def transcribe(wav_path: str) -> str:
    provider = config.get("api_provider", "openai")
    if provider == "nemo":
        language = config.get("nemo_language", "auto")
        return transcribe_nemo(wav_path, language)
    model = config.get("openai_model", "whisper-1")
    if model in LOCAL_WHISPER_MODELS:
        return transcribe_whisper_local(wav_path, model)
    return transcribe_openai(wav_path)


# ---------------------------------------------------------------------------
# Flask HTTP API
# ---------------------------------------------------------------------------

app = Flask(__name__)


@app.get("/config")
def get_config():
    return jsonify(config)


@app.post("/config")
def update_config():
    global config
    data = request.get_json(force=True)
    # Deep-merge modes to prevent losing selections, categories, or enabled states
    if "modes" in data and "modes" in config:
        incoming_modes = data["modes"]
        if "selections" in incoming_modes:
            config.setdefault("modes", {}).setdefault("selections", {}).update(incoming_modes["selections"])
        if "categories" in incoming_modes:
            config.setdefault("modes", {}).setdefault("categories", {}).update(incoming_modes["categories"])
        if "enabled" in incoming_modes:
            config.setdefault("modes", {}).setdefault("enabled", {}).update(incoming_modes["enabled"])
        del data["modes"]
    config.update(data)
    save_config(config)
    return jsonify(config)


@app.get("/status")
def get_status():
    return jsonify({"recording": recording})


@app.post("/start")
def api_start():
    t0 = time.time()
    logging.info("[/start] request received")
    ok = start_recording()
    logging.info("[/start] responding in %.3fs, started=%s", time.time() - t0, ok)
    return jsonify({"recording": True, "started": ok})


@app.post("/stop")
def api_stop():
    t0 = time.time()
    logging.info("[/stop] request received")
    ok = stop_recording()
    logging.info("[/stop] responding in %.3fs, stopped=%s", time.time() - t0, ok)
    return jsonify({"recording": False, "stopped": ok})


@app.post("/cancel")
def api_cancel():
    t0 = time.time()
    logging.info("[/cancel] request received")
    ok = cancel_recording()
    logging.info("[/cancel] responding in %.3fs, cancelled=%s", time.time() - t0, ok)
    return jsonify({"recording": False, "cancelled": ok})


# ---------------------------------------------------------------------------
# Reformat endpoints
# ---------------------------------------------------------------------------


@app.get("/modes")
def get_modes():
    return jsonify({
        "modes": ["default", "email", "slack"],
        "current": config.get("reformat_mode", "default"),
        "enabled": config.get("reformat_enabled", False),
    })


@app.post("/modes/select")
def select_mode():
    global config
    data = request.get_json(force=True)
    mode = data.get("mode", "default")
    if mode not in ("default", "email", "slack"):
        return jsonify({"error": "invalid mode"}), 400
    config["reformat_mode"] = mode
    save_config(config)
    return jsonify({"mode": mode})


@app.post("/reformat")
def api_reformat():
    data = request.get_json(force=True)
    text = data.get("text", "")
    mode = data.get("mode", config.get("reformat_mode", "default"))
    result = reformat_text(text, mode)
    return jsonify({"text": result})


# ---------------------------------------------------------------------------
# NeMo install management
# ---------------------------------------------------------------------------

_nemo_install_lock = threading.Lock()
_nemo_installing = False


@app.get("/nemo/status")
def nemo_status():
    try:
        import nemo.collections.asr  # noqa: F401
        return jsonify({"installed": True})
    except ImportError:
        return jsonify({"installed": False})


@app.post("/nemo/install")
def nemo_install():
    global _nemo_installing
    with _nemo_install_lock:
        if _nemo_installing:
            return jsonify({"error": "Installation already in progress"}), 409
        _nemo_installing = True

    def generate():
        global _nemo_installing
        try:
            python = sys.executable
            proc = subprocess.Popen(
                [python, "-m", "pip", "install", "nemo_toolkit[asr]"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in proc.stdout:
                yield f"data: {line.rstrip()}\n\n"
            proc.wait()
            if proc.returncode == 0:
                yield "data: __DONE__\n\n"
            else:
                yield f"data: __ERROR__ pip exited with code {proc.returncode}\n\n"
        except Exception as e:
            yield f"data: __ERROR__ {e}\n\n"
        finally:
            with _nemo_install_lock:
                _nemo_installing = False

    return Response(generate(), mimetype="text/event-stream")


# ---------------------------------------------------------------------------
# Local Whisper endpoints
# ---------------------------------------------------------------------------


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


_whisper_deps_installing = False
_whisper_deps_install_lock = threading.Lock()


@app.post("/whisper-local/install-deps")
def whisper_local_install_deps():
    global _whisper_deps_installing
    with _whisper_deps_install_lock:
        if _whisper_deps_installing:
            return jsonify({"error": "Installation already in progress"}), 409
        _whisper_deps_installing = True

    def generate():
        global _whisper_deps_installing
        try:
            python = sys.executable
            proc = subprocess.Popen(
                [python, "-m", "pip", "install", "transformers", "torch"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
            for line in proc.stdout:
                yield f"data: {line.rstrip()}\n\n"
            proc.wait()
            if proc.returncode == 0:
                yield "data: __DONE__\n\n"
            else:
                yield f"data: __ERROR__ pip exited with code {proc.returncode}\n\n"
        except Exception as e:
            yield f"data: __ERROR__ {e}\n\n"
        finally:
            with _whisper_deps_install_lock:
                _whisper_deps_installing = False

    return Response(generate(), mimetype="text/event-stream")


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


# ---------------------------------------------------------------------------
# History endpoints
# ---------------------------------------------------------------------------


@app.get("/history")
def get_history():
    return jsonify(_load_history())


@app.delete("/history")
def clear_history():
    with _history_lock:
        _save_history([])
    return jsonify({"cleared": True})


@app.delete("/history/<entry_id>")
def delete_history_entry(entry_id):
    with _history_lock:
        entries = _load_history()
        entries = [e for e in entries if e["id"] != entry_id]
        _save_history(entries)
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("[FindMyVoice] Starting backend on http://localhost:7890")
    app.run(host="127.0.0.1", port=7890, threaded=True)
