"""
Build-time constants for the Landa proxy.

In production builds, the release workflow rewrites this file with literal
string values just before PyInstaller bundles the backend.

In local development, the values come from environment variables — main.js
loads `landa/.env` (gitignored) and forwards the values when spawning the
Python subprocess.
"""
import os

LANDA_PROXY_URL = os.environ.get("LANDA_PROXY_URL", "")
LANDA_APP_SECRET = os.environ.get("LANDA_APP_SECRET", "")
