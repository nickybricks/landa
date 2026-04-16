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

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CONFIG_DIR = Path.home() / ".landa"
CONFIG_PATH = CONFIG_DIR / "config.json"
HISTORY_PATH = CONFIG_DIR / "history.json"
PRICING_PATH = CONFIG_DIR / "model_pricing.json"

# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------

PRICING_URL = "https://raw.githubusercontent.com/nickybricks/landa/main/pricing.json"

PRICING_DEFAULTS: dict = {
    "whisper-1":                    {"per_minute": 0.006},
    "whisper-large-v3":             {"per_minute": 0.006},
    "whisper-large-v3-turbo":       {"per_minute": 0.006},
    "gpt-4o-mini":                  {"input_per_1m": 0.15,  "output_per_1m": 0.60},
    "gpt-4o":                       {"input_per_1m": 2.50,  "output_per_1m": 10.00},
    "gpt-4.1":                      {"input_per_1m": 2.00,  "output_per_1m": 8.00},
    "gpt-4.1-mini":                 {"input_per_1m": 0.40,  "output_per_1m": 1.60},
    "claude-haiku-4-5-20251001":    {"input_per_1m": 0.80,  "output_per_1m": 4.00},
    "claude-sonnet-4-6":            {"input_per_1m": 3.00,  "output_per_1m": 15.00},
    "claude-opus-4-6":              {"input_per_1m": 15.00, "output_per_1m": 75.00},
}

_pricing_cache: dict | None = None


def _load_pricing() -> dict:
    """Load pricing from cache file, refreshing from URL if older than 24 h."""
    global _pricing_cache
    if _pricing_cache is not None:
        return _pricing_cache
    if PRICING_PATH.exists():
        age = time.time() - PRICING_PATH.stat().st_mtime
        if age < 86400:
            try:
                with open(PRICING_PATH) as f:
                    _pricing_cache = json.load(f)
                    return _pricing_cache
            except Exception:
                pass
    # Try to refresh from hosted URL
    try:
        import urllib.request
        with urllib.request.urlopen(PRICING_URL, timeout=3) as r:
            data = json.loads(r.read())
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(PRICING_PATH, "w") as f:
            json.dump(data, f, indent=2)
        _pricing_cache = data
        return _pricing_cache
    except Exception:
        pass
    # Fall back to bundled defaults; persist so they survive the TTL check next run
    if not PRICING_PATH.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(PRICING_PATH, "w") as f:
            json.dump(PRICING_DEFAULTS, f, indent=2)
    _pricing_cache = PRICING_DEFAULTS
    return _pricing_cache


def _calc_cost(model: str, input_tokens: int = 0, output_tokens: int = 0, duration_seconds: float = 0.0) -> float:
    pricing = _load_pricing().get(model, {})
    if "per_minute" in pricing:
        return round(pricing["per_minute"] * duration_seconds / 60, 6)
    ipm = pricing.get("input_per_1m", 0)
    opm = pricing.get("output_per_1m", 0)
    return round((input_tokens * ipm + output_tokens * opm) / 1_000_000, 6)

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
        "toggles": {
            "email": {
                "formal": {"include_greeting": True, "include_sign_off": True},
                "casual": {"include_greeting": True, "include_sign_off": True},
                "excited": {"include_greeting": True, "include_sign_off": True},
            },
            "personal-message": {
                "formal": {"use_emoji": False},
                "casual": {"use_emoji": False},
                "excited": {"use_emoji": False},
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
            allowed = {"whisper-1", "whisper-base", "whisper-small", "whisper-medium", "whisper-large-v3", "whisper-large-v3-turbo"}
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
        try:
            with open(CONFIG_PATH) as f:
                saved = json.load(f)
        except (json.JSONDecodeError, OSError):
            save_config(DEFAULT_CONFIG)
            return dict(DEFAULT_CONFIG)
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


def add_history_entry(text: str, usage: dict | None = None) -> None:
    entry = {
        "id": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "text": text,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if usage:
        entry["usage"] = usage
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
            "Fix grammar and remove filler words. Do not add content that wasn't spoken. "
            "Do not include a subject line. Return only the email body."
        ),
        "casual": (
            "Reformat the following dictated text into a casual email body. "
            "Use capitalization but lighter punctuation. Keep sentences flowing naturally. "
            "Fix grammar and filler words. "
            "Do not translate or change the language. "
            "Do not replace greetings, names, or terms of address with alternatives. "
            "Do not add content that wasn't spoken. Do not include a subject line. "
            "IMPORTANT: Do not invent, hallucinate, or fill in any names, sign-offs, or greetings "
            "that were not explicitly spoken. If the user did not say a closing name or greeting name, do not add one. "
            "If a greeting or sign-off is needed, use [NAME] as a placeholder — never invent a name."
            "Return only the email body."
        ),
        "excited": (
            "Reformat the following dictated text into an enthusiastic email body. "
            "Use exclamation marks to convey energy and positivity. "
            "Keep the tone warm, upbeat, and professional. "
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
    prompt = MODE_SYSTEM_PROMPTS.get(category, MODE_SYSTEM_PROMPTS["personal-message"]).get(
        style, MODE_SYSTEM_PROMPTS["personal-message"]["formal"]
    )
    toggles = config.get("modes", {}).get("toggles", {}).get(category, {}).get(style, {})
    if category == "email":
        if toggles.get("include_greeting", True):
            prompt += " Include an appropriate greeting or opening salutation."
        else:
            prompt += " Do not include a greeting or opening salutation."
        if toggles.get("include_sign_off", True):
            prompt += " Include an appropriate sign-off or closing."
        else:
            prompt += " Do not include a sign-off or closing. Still use proper email paragraph structure with line breaks between sections."
    elif category == "personal-message":
        if toggles.get("use_emoji", False):
            prompt += " Use relevant emoji to add expressiveness."
    return prompt


def _build_lang_instruction() -> str:
    """Build an explicit language instruction from the configured or detected language.
    Uses the config setting first; falls back to the auto-detected language from
    the last Whisper transcription. This ensures the LLM always gets an explicit
    language name instead of a vague 'respond in the same language'."""
    lang_code = config.get("openai_language", "auto")
    if not lang_code or lang_code == "auto":
        lang_code = _detected_language
    lang_name = _LANG_CODE_TO_NAME.get(lang_code) if lang_code else None
    if lang_name:
        return (
            f"IMPORTANT: You MUST respond in {lang_name}. Do not translate the text. "
            f"Apply all correct grammatical conventions of {lang_name}, including language-specific capitalization rules."
        )
    return (
        "IMPORTANT: You MUST respond in the same language as the input text. Do not translate. "
        "Apply all correct grammatical conventions of that language, including language-specific capitalization rules."
    )


def reformat_text(text: str, mode: str | None = None) -> tuple[str, dict | None]:
    """Post-process transcription via configured LLM. Falls back to original text on any error."""
    llm_provider = config.get("llm_provider", "openai")

    if mode and mode in REFORMAT_PROMPTS:
        prompt = REFORMAT_PROMPTS[mode]
    else:
        prompt = get_mode_prompt()
        if prompt is None:
            return text, None

    # Prepend language instruction so every provider (local, OpenAI, Anthropic)
    # preserves the spoken language instead of defaulting to English.
    lang_instruction = _build_lang_instruction()
    prompt = lang_instruction + "\n\n" + prompt

    print(f"[Landa] reformat_text: provider={llm_provider}, lang_instruction={lang_instruction[:80]!r}")
    print(f"[Landa] reformat_text: input={text[:200]!r}")

    # Local model path — no API key needed
    if llm_provider == "local":
        model_id = config.get("llm_model", "gemma-3-4b")
        t0 = time.time()
        result = reformat_text_local(text, prompt, model_id)
        latency_ms = round((time.time() - t0) * 1000)
        usage = {"step": "reformat", "model": model_id, "input_tokens": 0, "output_tokens": 0, "latency_ms": latency_ms, "cost": 0.0, "local": True}
        return result, usage

    # Use dedicated LLM key; fall back to transcription key when both providers are openai
    api_key = config.get("llm_api_key", "") or (
        config.get("api_key", "") if llm_provider == "openai" else ""
    )
    if not api_key:
        return text, None

    llm_model = config.get("llm_model", "") or (
        "gpt-4o-mini" if llm_provider == "openai" else "claude-haiku-4-5-20251001"
    )

    try:
        if llm_provider == "anthropic":
            try:
                import anthropic
            except ImportError:
                print("[FindMyVoice] Anthropic SDK not installed. Run: pip install anthropic")
                return text, None
            client = anthropic.Anthropic(api_key=api_key)
            t0 = time.time()
            response = client.messages.create(
                model=llm_model,
                max_tokens=1024,
                system=prompt,
                messages=[{"role": "user", "content": text}],
            )
            latency_ms = round((time.time() - t0) * 1000)
            result = response.content[0].text.strip()
            print(f"[Landa] reformat_text: output={result[:200]!r}")
            u = response.usage
            cost = _calc_cost(llm_model, u.input_tokens, u.output_tokens)
            usage = {
                "step": "reformat",
                "model": llm_model,
                "input_tokens": u.input_tokens,
                "output_tokens": u.output_tokens,
                "latency_ms": latency_ms,
                "cost": cost,
            }
            return result, usage
        else:
            client = OpenAI(api_key=api_key, timeout=httpx.Timeout(3.0))
            t0 = time.time()
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text},
                ],
            )
            latency_ms = round((time.time() - t0) * 1000)
            result = response.choices[0].message.content.strip()
            print(f"[Landa] reformat_text: output={result[:200]!r}")
            u = response.usage
            cost = _calc_cost(llm_model, u.prompt_tokens, u.completion_tokens)
            usage = {
                "step": "reformat",
                "model": llm_model,
                "input_tokens": u.prompt_tokens,
                "output_tokens": u.completion_tokens,
                "latency_ms": latency_ms,
                "cost": cost,
            }
            return result, usage
    except Exception as e:
        print(f"[FindMyVoice] Reformat error (falling back to raw text): {e}")
        return text, None


# ---------------------------------------------------------------------------
# Audio recording state
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16000
recording = False
audio_frames: list[np.ndarray] = []
stream: sd.InputStream | None = None
_teardown_thread: threading.Thread | None = None  # tracks in-flight stream teardown
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
# Silence detection should only catch obviously empty taps/clicks. For real
# recordings, even quiet speech should still reach transcription.
_SILENCE_RMS_THRESHOLD = 0.0015
_SILENCE_PEAK_THRESHOLD = 0.008
_MIN_SKIP_DURATION_S = 0.2


def _analyze_audio(audio: np.ndarray) -> tuple[float, float, float]:
    """Return (duration_s, rms, peak) for the captured audio."""
    flat = np.asarray(audio, dtype=np.float32).reshape(-1)
    if flat.size == 0:
        return (0.0, 0.0, 0.0)

    duration_s = flat.size / SAMPLE_RATE
    rms = float(np.sqrt(np.mean(flat ** 2)))
    peak = float(np.max(np.abs(flat)))
    return (duration_s, rms, peak)


def _should_skip_transcription(audio: np.ndarray) -> bool:
    """Skip only truly empty or ultra-short near-zero audio clips."""
    duration_s, rms, peak = _analyze_audio(audio)
    logging.info(
        "[silence_check] duration=%.3fs rms=%.6f (threshold=%.6f) peak=%.6f (threshold=%.6f)",
        duration_s,
        rms,
        _SILENCE_RMS_THRESHOLD,
        peak,
        _SILENCE_PEAK_THRESHOLD,
    )
    if duration_s == 0:
        return True
    return (
        duration_s < _MIN_SKIP_DURATION_S
        and rms < _SILENCE_RMS_THRESHOLD
        and peak < _SILENCE_PEAK_THRESHOLD
    )


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
    global recording, stream, audio_frames, _teardown_thread
    t0 = time.time()
    logging.info("[start_recording] called")
    # If a previous stream teardown is still running, wait for it to finish
    # before creating a new InputStream to avoid PortAudio deadlocks.
    if _teardown_thread is not None and _teardown_thread.is_alive():
        logging.info("[start_recording] waiting for previous stream teardown...")
        _teardown_thread.join(timeout=5.0)
        if _teardown_thread.is_alive():
            logging.warning("[start_recording] previous teardown still running after 5s — proceeding anyway")
        else:
            logging.info("[start_recording] previous teardown finished")
        _teardown_thread = None
    with lock:
        if recording:
            logging.info("[start_recording] already recording, returning False")
            return False
        audio_frames = []
    # Create and start the InputStream OUTSIDE the lock — sd.InputStream()
    # can hang if PortAudio is in a bad state, and holding the lock would
    # deadlock all recording operations.  Use a thread with timeout so a
    # hung PortAudio doesn't block the HTTP response forever.
    t1 = time.time()
    logging.info("[start_recording] creating InputStream... (%.3fs since entry)", time.time() - t0)
    new_stream = None
    create_error = None

    def _create_stream():
        nonlocal new_stream, create_error
        try:
            s = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                callback=_audio_callback,
            )
            s.start()
            new_stream = s
        except Exception as e:
            create_error = e

    creator = threading.Thread(target=_create_stream, daemon=True)
    creator.start()
    creator.join(timeout=8.0)
    if creator.is_alive():
        logging.error("[start_recording] InputStream creation timed out after 8s")
        return False
    if create_error is not None:
        logging.error("[start_recording] InputStream creation failed after %.3fs: %s", time.time() - t1, create_error)
        raise create_error
    if new_stream is None:
        logging.error("[start_recording] InputStream creation returned None")
        return False
    logging.info("[start_recording] stream created+started in %.3fs", time.time() - t1)
    with lock:
        stream = new_stream
        recording = True
    play_sound(config.get("sound_start", "Tink"))
    logging.info("[start_recording] done in %.3fs total", time.time() - t0)
    return True


def stop_recording() -> bool:
    global recording, stream, _teardown_thread
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
    # We use a thread + join(timeout) so a hung teardown doesn't block the
    # entire /stop response (sound, transcription, and HTTP reply).
    if old_stream is not None:
        t1 = time.time()
        def _teardown():
            try:
                old_stream.abort()
                old_stream.close()
            except Exception as e:
                logging.error("[stop_recording] stream teardown error: %s", e)
        td = threading.Thread(target=_teardown, daemon=True)
        td.start()
        td.join(timeout=3.0)
        _teardown_thread = td
        if td.is_alive():
            logging.warning("[stop_recording] stream teardown still running after 3s — proceeding anyway (%.3fs)", time.time() - t1)
        else:
            logging.info("[stop_recording] stream teardown completed in %.3fs", time.time() - t1)
    play_sound(config.get("sound_stop", "Pop"))
    threading.Thread(target=_transcribe_and_paste, daemon=True).start()
    logging.info("[stop_recording] done in %.3fs total", time.time() - t0)
    return True


def cancel_recording() -> bool:
    """Stop recording and discard audio — no transcription or paste."""
    global recording, stream, audio_frames, _teardown_thread
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
        def _teardown():
            try:
                old_stream.abort()
                old_stream.close()
            except Exception as e:
                logging.error("[cancel_recording] stream teardown error: %s", e)
        td = threading.Thread(target=_teardown, daemon=True)
        td.start()
        td.join(timeout=3.0)
        _teardown_thread = td
        if td.is_alive():
            logging.warning("[cancel_recording] stream teardown still running after 3s — proceeding anyway (%.3fs)", time.time() - t1)
        else:
            logging.info("[cancel_recording] stream teardown completed in %.3fs", time.time() - t1)
    logging.info("[cancel_recording] done in %.3fs total — audio discarded", time.time() - t0)
    return True


def _transcribe_and_paste() -> None:
    if not audio_frames:
        return

    pipeline_start = time.time()  # start timing from hotkey-stop → paste

    # Write wav to a temp file
    audio = np.concatenate(audio_frames, axis=0)

    if _should_skip_transcription(audio):
        logging.info("[transcribe] Skipping — audio buffer is effectively empty")
        return

    audio_int16 = np.int16(audio * 32767)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    wavfile.write(tmp.name, SAMPLE_RATE, audio_int16)
    tmp.close()

    try:
        prep_latency_ms = round((time.time() - pipeline_start) * 1000)
        text, transcribe_usage = transcribe(tmp.name)
        if not text:
            return
        text = post_process(text)
        reformat_usage = None
        if text:
            text, reformat_usage = reformat_text(text)
        if text:
            paste_latency_ms = None
            if config.get("auto_paste", True):
                t_paste = time.time()
                paste_text(text)
                paste_latency_ms = round((time.time() - t_paste) * 1000)
            total_latency_ms = round((time.time() - pipeline_start) * 1000)
            steps = [u for u in [transcribe_usage, reformat_usage] if u is not None]
            combined_usage = None
            if steps:
                total_tokens = sum(s.get("input_tokens", 0) + s.get("output_tokens", 0) for s in steps)
                total_cost = round(sum(s.get("cost", 0.0) for s in steps), 6)
                combined_usage = {"steps": steps, "total_tokens": total_tokens, "total_cost": total_cost, "prep_latency_ms": prep_latency_ms, "paste_latency_ms": paste_latency_ms, "total_latency_ms": total_latency_ms}
            add_history_entry(text, usage=combined_usage)
    finally:
        os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Local Whisper (whisper.cpp via pywhispercpp)
# ---------------------------------------------------------------------------

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
_detected_language: str | None = None     # last auto-detected language code (e.g. "de")
_whisper_download_state: dict = {}        # model_name -> {downloading, cached, error, progress_bytes, total_bytes}
_whisper_download_lock = threading.Lock()


def is_pywhispercpp_installed() -> bool:
    try:
        from pywhispercpp.model import Model as _WhisperModel  # noqa: F401
        return True
    except ImportError:
        return False


def is_whisper_model_cached(model_name: str) -> bool:
    info = WHISPER_GGML_MODELS.get(model_name)
    if not info:
        return False
    return (WHISPER_MODELS_DIR / info["filename"]).exists()


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


def start_whisper_download(model_name: str) -> None:
    with _whisper_download_lock:
        state = _whisper_download_state.get(model_name, {})
        if state.get("downloading"):
            return  # already in progress
    threading.Thread(target=_do_whisper_download, args=(model_name,), daemon=True).start()


def transcribe_whisper_local(wav_path: str, model_name: str) -> str:
    global _detected_language
    _local_usage = {"step": "transcription", "model": model_name, "input_tokens": 0, "output_tokens": 0, "duration_seconds": 0.0, "latency_ms": 0, "cost": 0.0, "local": True}
    try:
        from pywhispercpp.model import Model as WhisperModel
    except ImportError:
        return "[Error] pywhispercpp not installed. Please install from the Settings page.", _local_usage

    if model_name not in _whisper_cpp_model_cache:
        info = WHISPER_GGML_MODELS.get(model_name)
        if not info:
            return f"[Error] Unknown local model: {model_name}", _local_usage
        model_path = WHISPER_MODELS_DIR / info["filename"]
        if not model_path.exists():
            return f"[Error] Model file not found: {model_path}. Please download from Settings.", _local_usage
        _whisper_cpp_model_cache[model_name] = WhisperModel(str(model_path))

    import contextlib, wave as wave_mod
    try:
        with contextlib.closing(wave_mod.open(wav_path, "r")) as wf:
            duration_seconds = wf.getnframes() / wf.getframerate()
    except Exception:
        duration_seconds = 0.0

    model = _whisper_cpp_model_cache[model_name]
    language = config.get("openai_language", "auto")

    t0 = time.time()  # start timing before language detection
    if language and language != "auto":
        _detected_language = language
    else:
        # Explicitly detect the language before transcribing. Without this,
        # Whisper often defaults to English on short clips or produces
        # hallucinations like "(speaking in foreign language)".
        try:
            (detected_code, prob), _ = model.auto_detect_language(wav_path)
            _detected_language = detected_code
            print(f"[Landa] auto_detect_language: {detected_code} (prob={prob:.2f})")
        except Exception as e:
            print(f"[Landa] auto_detect_language failed, proceeding without: {e}")
            _detected_language = None

    kwargs = {}
    if _detected_language:
        kwargs["language"] = _detected_language

    print(f"[Landa] transcribe_whisper_local: model={model_name}, language={_detected_language}, kwargs={kwargs}")
    segments = model.transcribe(wav_path, **kwargs)
    latency_ms = round((time.time() - t0) * 1000)
    text = " ".join(seg.text for seg in segments).strip()
    print(f"[Landa] transcribe_whisper_local: output={text[:200]!r}")
    usage = {"step": "transcription", "model": model_name, "input_tokens": 0, "output_tokens": 0, "duration_seconds": round(duration_seconds, 2), "latency_ms": latency_ms, "cost": 0.0, "local": True}
    return text, usage


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


# ---------------------------------------------------------------------------
# Local LLM — mlx-lm on macOS, llama-cpp-python (GGUF) on Windows
# ---------------------------------------------------------------------------

MODELS_DIR = CONFIG_DIR / "models"

# Registry — add new models here only. One entry per model supports both platforms.
#   mlx_repo  : HuggingFace repo for the MLX-quantized model (macOS)
#   hf_repo   : HuggingFace repo for the GGUF model (Windows)
#   filename  : GGUF filename stored in MODELS_DIR (Windows only)
LLM_LOCAL_MODELS: dict[str, dict] = {
    "gemma-3-4b": {
        "name": "Gemma 3 4B",
        "mlx_repo": "mlx-community/gemma-3-4b-it-4bit",
        "hf_repo": "bartowski/gemma-3-4b-it-GGUF",
        "filename": "gemma-3-4b-it-Q4_K_M.gguf",
        "size_label": "~2.5 GB",
        "size_bytes": 2_670_000_000,
    },
}

_llm_model_cache: dict = {}     # model_id -> loaded model object
_llm_download_state: dict = {}  # model_id -> {downloading, cached, error, progress_bytes, total_bytes}
_llm_download_lock = threading.Lock()


def is_llm_deps_installed() -> tuple[bool, str | None]:
    """Check whether the platform-appropriate inference library is installed.
    Returns (installed, error_message_or_None).
    """
    if sys.platform == "darwin":
        try:
            import mlx_lm  # noqa: F401
            return True, None
        except Exception as e:
            logging.warning(f"[FindMyVoice] mlx_lm import failed: {e}")
            return False, str(e)
    else:
        try:
            import llama_cpp  # noqa: F401
            return True, None
        except Exception as e:
            logging.warning(f"[FindMyVoice] llama_cpp import failed: {e}")
            return False, str(e)


def is_llm_model_cached(model_id: str) -> bool:
    info = LLM_LOCAL_MODELS.get(model_id)
    if not info:
        return False
    if sys.platform == "darwin":
        try:
            from huggingface_hub import snapshot_download
            snapshot_download(info["mlx_repo"], local_files_only=True)
            return True
        except Exception:
            return False
    else:
        return (MODELS_DIR / info["filename"]).exists()


def _do_llm_download(model_id: str) -> None:
    info = LLM_LOCAL_MODELS[model_id]
    with _llm_download_lock:
        _llm_download_state[model_id] = {
            "downloading": True, "cached": False, "error": None,
            "progress_bytes": 0, "total_bytes": info.get("size_bytes", 0),
        }
    try:
        if sys.platform == "darwin":
            # macOS: download the MLX HuggingFace repo (HF handles caching/resume)
            from huggingface_hub import snapshot_download
            print(f"[FindMyVoice] Downloading MLX model: {info['mlx_repo']}")
            snapshot_download(info["mlx_repo"])
        else:
            # Windows: stream the GGUF file with byte-level progress
            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            dest = MODELS_DIR / info["filename"]
            url = f"https://huggingface.co/{info['hf_repo']}/resolve/main/{info['filename']}"
            print(f"[FindMyVoice] Downloading GGUF: {url}")
            with httpx.stream("GET", url, follow_redirects=True, timeout=None) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("content-length", info.get("size_bytes", 0)))
                with _llm_download_lock:
                    _llm_download_state[model_id]["total_bytes"] = total
                downloaded = 0
                with open(dest, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        with _llm_download_lock:
                            _llm_download_state[model_id]["progress_bytes"] = downloaded

        with _llm_download_lock:
            _llm_download_state[model_id] = {
                "downloading": False, "cached": True, "error": None,
                "progress_bytes": 0, "total_bytes": 0,
            }
        print(f"[FindMyVoice] LLM download complete: {model_id}")
    except Exception as e:
        # Clean up partial GGUF on failure (macOS uses HF cache, no cleanup needed)
        if sys.platform != "darwin":
            dest = MODELS_DIR / info["filename"]
            if dest.exists():
                dest.unlink()
        with _llm_download_lock:
            _llm_download_state[model_id] = {
                "downloading": False, "cached": False, "error": str(e),
                "progress_bytes": 0, "total_bytes": 0,
            }
        print(f"[FindMyVoice] LLM download failed: {e}")


def start_llm_download(model_id: str) -> None:
    with _llm_download_lock:
        state = _llm_download_state.get(model_id, {})
        if state.get("downloading"):
            return
    threading.Thread(target=_do_llm_download, args=(model_id,), daemon=True).start()


def _get_llm_model(model_id: str):
    """Lazy-load the inference model into memory on first call."""
    if model_id in _llm_model_cache:
        return _llm_model_cache[model_id]
    info = LLM_LOCAL_MODELS.get(model_id)
    if not info:
        return None
    try:
        if sys.platform == "darwin":
            from mlx_lm import load
            print(f"[FindMyVoice] Loading MLX model: {model_id}")
            model, tokenizer = load(info["mlx_repo"])
            _llm_model_cache[model_id] = (model, tokenizer)
            print(f"[FindMyVoice] MLX model ready: {model_id}")
            return (model, tokenizer)
        else:
            from llama_cpp import Llama
            model_path = MODELS_DIR / info["filename"]
            if not model_path.exists():
                return None
            print(f"[FindMyVoice] Loading GGUF model: {model_id}")
            llm = Llama(model_path=str(model_path), n_ctx=2048, n_gpu_layers=-1, verbose=False)
            _llm_model_cache[model_id] = llm
            print(f"[FindMyVoice] GGUF model ready: {model_id}")
            return llm
    except Exception as e:
        print(f"[FindMyVoice] Failed to load local LLM {model_id}: {e}")
        return None


# ISO 639-1 code → language name for explicit LLM instructions
_LANG_CODE_TO_NAME: dict[str, str] = {
    "af": "Afrikaans", "ar": "Arabic", "hy": "Armenian", "az": "Azerbaijani",
    "be": "Belarusian", "bs": "Bosnian", "bg": "Bulgarian", "ca": "Catalan",
    "zh": "Chinese", "hr": "Croatian", "cs": "Czech", "da": "Danish",
    "nl": "Dutch", "en": "English", "et": "Estonian", "fi": "Finnish",
    "fr": "French", "gl": "Galician", "de": "German", "el": "Greek",
    "he": "Hebrew", "hi": "Hindi", "hu": "Hungarian", "is": "Icelandic",
    "id": "Indonesian", "it": "Italian", "ja": "Japanese", "kn": "Kannada",
    "kk": "Kazakh", "ko": "Korean", "lv": "Latvian", "lt": "Lithuanian",
    "mk": "Macedonian", "ms": "Malay", "mr": "Marathi", "mi": "Maori",
    "ne": "Nepali", "no": "Norwegian", "fa": "Persian", "pl": "Polish",
    "pt": "Portuguese", "ro": "Romanian", "ru": "Russian", "sr": "Serbian",
    "sk": "Slovak", "sl": "Slovenian", "es": "Spanish", "sw": "Swahili",
    "sv": "Swedish", "tl": "Tagalog", "ta": "Tamil", "th": "Thai",
    "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu", "vi": "Vietnamese",
    "cy": "Welsh",
}


def reformat_text_local(text: str, prompt: str, model_id: str) -> str:
    """Run reformatting inference locally. Uses mlx-lm on macOS, llama-cpp on Windows.
    The prompt already contains the language instruction (prepended by reformat_text)."""
    loaded = _get_llm_model(model_id)
    if loaded is None:
        print(f"[FindMyVoice] Local LLM not available: {model_id}")
        return text

    # Also inject the language instruction into the user turn — Gemma3's chat
    # template may fold or drop the system role, so this ensures it survives.
    lang_instruction = _build_lang_instruction()
    user_content = f"[{lang_instruction}]\n\n{text}"

    try:
        if sys.platform == "darwin":
            from mlx_lm import generate
            model, tokenizer = loaded
            messages = [
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ]
            formatted = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            result = generate(model, tokenizer, prompt=formatted, max_tokens=1024, verbose=False)
            return result.strip()
        else:
            response = loaded.create_chat_completion(
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ],
                max_tokens=1024,
                temperature=0.1,
            )
            return response["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[FindMyVoice] Local LLM inference error: {e}")
        return text


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


def transcribe_nemo(audio_path: str, language: str) -> tuple[str, dict]:
    import contextlib, wave as wave_mod
    global _nemo_model
    try:
        import nemo.collections.asr as nemo_asr
    except ImportError:
        return "[Error] NeMo is not installed. Run: pip install nemo_toolkit['asr']", {"step": "transcription", "model": "nvidia/parakeet-tdt-0.6b-v3", "input_tokens": 0, "output_tokens": 0, "duration_seconds": 0.0, "latency_ms": 0, "cost": 0.0, "local": True}

    try:
        with contextlib.closing(wave_mod.open(audio_path, "r")) as wf:
            duration_seconds = wf.getnframes() / wf.getframerate()
    except Exception:
        duration_seconds = 0.0

    if _nemo_model is None:
        _nemo_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")

    t0 = time.time()
    output = _nemo_model.transcribe([audio_path])
    latency_ms = round((time.time() - t0) * 1000)
    usage = {"step": "transcription", "model": "nvidia/parakeet-tdt-0.6b-v3", "input_tokens": 0, "output_tokens": 0, "duration_seconds": round(duration_seconds, 2), "latency_ms": latency_ms, "cost": 0.0, "local": True}
    return output[0].text, usage


def transcribe_openai(wav_path: str) -> tuple[str, dict | None]:
    import contextlib
    import wave as wave_mod

    api_key = config.get("api_key", "")
    if not api_key:
        print("[FindMyVoice] No API key configured.")
        return "", None

    client = OpenAI(api_key=api_key)

    language = config.get("openai_language", "auto")

    try:
        with contextlib.closing(wave_mod.open(wav_path, "r")) as wf:
            duration_seconds = wf.getnframes() / wf.getframerate()
    except Exception:
        duration_seconds = 0.0

    try:
        with open(wav_path, "rb") as f:
            model_name = config.get("openai_model", "whisper-1")
            kwargs: dict = {"model": model_name, "file": f}
            if language and language != "auto":
                kwargs["language"] = language
            t0 = time.time()
            transcript = client.audio.transcriptions.create(**kwargs)
            latency_ms = round((time.time() - t0) * 1000)
        cost = _calc_cost(model_name, duration_seconds=duration_seconds)
        usage = {
            "step": "transcription",
            "model": model_name,
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_seconds": round(duration_seconds, 2),
            "latency_ms": latency_ms,
            "cost": cost,
        }
        return transcript.text.strip(), usage
    except Exception as e:
        print(f"[FindMyVoice] Transcription error: {e}")
        return "", None


def transcribe(wav_path: str) -> tuple[str, dict | None]:
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
        if "toggles" in incoming_modes:
            existing = config.setdefault("modes", {}).setdefault("toggles", {})
            for cat, cat_toggles in incoming_modes["toggles"].items():
                existing.setdefault(cat, {})
                for style_key, style_toggles in cat_toggles.items():
                    if isinstance(style_toggles, dict):
                        if not isinstance(existing[cat].get(style_key), dict):
                            existing[cat][style_key] = {}
                        existing[cat][style_key].update(style_toggles)
                    else:
                        existing[cat][style_key] = style_toggles
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
    result, _ = reformat_text(text, mode)
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
                [python, "-m", "pip", "install", "pywhispercpp"],
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
    if not is_pywhispercpp_installed():
        return jsonify({"error": "pywhispercpp not installed"}), 400
    start_whisper_download(model_name)
    return jsonify({"started": True})


# ---------------------------------------------------------------------------
# Local LLM endpoints
# ---------------------------------------------------------------------------


@app.get("/llm-local/status")
def llm_local_status():
    model_id = request.args.get("model") or config.get("llm_model", "gemma-3-4b")
    if model_id not in LLM_LOCAL_MODELS:
        return jsonify({"model": model_id, "is_local": False})

    deps_installed, deps_error = is_llm_deps_installed()
    with _llm_download_lock:
        state = dict(_llm_download_state.get(model_id, {}))

    downloading = state.get("downloading", False)
    cached = state.get("cached", False)
    error = state.get("error")
    progress_bytes = state.get("progress_bytes", 0)
    total_bytes = state.get("total_bytes", 0)

    # If no in-memory state yet, check disk
    if not state and not downloading:
        cached = is_llm_model_cached(model_id)
        with _llm_download_lock:
            _llm_download_state[model_id] = {
                "downloading": False, "cached": cached, "error": None,
                "progress_bytes": 0, "total_bytes": 0,
            }

    return jsonify({
        "model": model_id,
        "is_local": True,
        "deps_installed": deps_installed,
        "deps_error": deps_error,
        "cached": cached,
        "downloading": downloading,
        "error": error,
        "progress_bytes": progress_bytes,
        "total_bytes": total_bytes,
    })


_llm_deps_installing = False
_llm_deps_install_lock = threading.Lock()


@app.post("/llm-local/install-deps")
def llm_local_install_deps():
    global _llm_deps_installing
    with _llm_deps_install_lock:
        if _llm_deps_installing:
            return jsonify({"error": "Installation already in progress"}), 409
        _llm_deps_installing = True

    def generate():
        global _llm_deps_installing
        try:
            python = sys.executable
            if sys.platform == "darwin":
                # mlx-lm: Apple's ML framework for Apple Silicon — pure pip, no compilation
                pkg = "mlx-lm"
            else:
                # Windows: pre-built llama-cpp-python wheel
                pkg = "llama-cpp-python"

            cmd = [python, "-m", "pip", "install", pkg, "--upgrade"]
            if sys.platform != "darwin":
                cmd.append("--prefer-binary")

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
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
            with _llm_deps_install_lock:
                _llm_deps_installing = False

    return Response(generate(), mimetype="text/event-stream")


@app.post("/llm-local/download")
def llm_local_download():
    data = request.get_json(force=True)
    model_id = data.get("model") or config.get("llm_model", "gemma-3-4b")
    if model_id not in LLM_LOCAL_MODELS:
        return jsonify({"error": "unknown local model"}), 400
    deps_ok, _ = is_llm_deps_installed()
    if not deps_ok:
        return jsonify({"error": "inference engine not installed"}), 400
    start_llm_download(model_id)
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
