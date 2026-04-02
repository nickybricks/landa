"""FindMyVoice — lightweight voice-to-text backend.

Records from the default mic, transcribes via OpenAI Whisper API or NVIDIA
NeMo Parakeet (local), and pastes the result into the active app.  Exposes a
local HTTP API on localhost:7890 for the SwiftUI frontend.  Hotkey listening is
handled by the Swift app.
"""

import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
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

DEFAULT_CONFIG: dict = {
    "api_key": "",
    "api_provider": "openai",
    "openai_model": "whisper-1",
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
    """Post-process transcription via GPT-4o-mini. Falls back to original text on any error."""
    api_key = config.get("api_key", "")
    if not api_key:
        return text

    if mode and mode in REFORMAT_PROMPTS:
        prompt = REFORMAT_PROMPTS[mode]
    else:
        prompt = get_mode_prompt()
        if prompt is None:
            return text

    try:
        client = OpenAI(api_key=api_key, timeout=httpx.Timeout(3.0))
        response = client.chat.completions.create(
            model="gpt-4o-mini",
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
    """Play a macOS system sound by name (non-blocking)."""
    path = f"/System/Library/Sounds/{name}.aiff"
    if os.path.exists(path):
        subprocess.Popen(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def paste_text(text: str) -> None:
    """Copy *text* to the clipboard and simulate Cmd+V."""
    process = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
    process.communicate(text.encode("utf-8"))

    import time
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
    with lock:
        if recording:
            return False
        audio_frames = []
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            callback=_audio_callback,
        )
        stream.start()
        recording = True
    play_sound(config.get("sound_start", "Tink"))
    return True


def stop_recording() -> bool:
    global recording, stream
    with lock:
        if not recording:
            return False
        if stream is not None:
            stream.stop()
            stream.close()
            stream = None
        recording = False
    play_sound(config.get("sound_stop", "Pop"))
    threading.Thread(target=_transcribe_and_paste, daemon=True).start()
    return True


def _transcribe_and_paste() -> None:
    if not audio_frames:
        return

    # Write wav to a temp file
    audio = np.concatenate(audio_frames, axis=0)
    audio_int16 = np.int16(audio * 32767)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    wavfile.write(tmp.name, SAMPLE_RATE, audio_int16)
    tmp.close()

    try:
        text = transcribe(tmp.name)
        text = post_process(text)
        if text and config.get("api_key"):
            text = reformat_text(text)
        if text and config.get("auto_paste", True):
            paste_text(text)
    finally:
        os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

_nemo_model = None


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
    kwargs: dict = {"model": config.get("openai_model", "whisper-1"), "file": open(wav_path, "rb")}
    if language and language != "auto":
        kwargs["language"] = language

    try:
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
    ok = start_recording()
    return jsonify({"recording": True, "started": ok})


@app.post("/stop")
def api_stop():
    ok = stop_recording()
    return jsonify({"recording": False, "stopped": ok})


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
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("[FindMyVoice] Starting backend on http://localhost:7890")
    app.run(host="127.0.0.1", port=7890, threaded=True)
