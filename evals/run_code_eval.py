#!/usr/bin/env python3
"""Regression eval for the `code` category prompt (adaptive per-app style, slice 1).

Runs a fixed corpus of realistic raw transcriptions through the live reformat path
and checks each output against per-case assertions, so a future prompt change that
breaks jargon reconstruction — or makes the model start *answering* prompts instead
of cleaning them — fails loudly.

Run from the repo root with the proxy creds loaded:

    set -a && . ./.env && set +a
    ./backend/venv/bin/python evals/run_code_eval.py

Exits 0 if all cases pass, 1 otherwise. Needs LANDA_PROXY_URL + LANDA_APP_SECRET.
"""

import copy
import json
import os
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

import landa_core as lc  # noqa: E402

# Answering a prompt balloons length; cleaning it does not. Flag outputs that grow
# past this multiple of the input (word count) as a likely "it answered" regression.
MAX_LEN_RATIO = 2.5
MIN_WORDS_FOR_RATIO = 5


def check(case: dict, out: str) -> list[str]:
    """Return a list of failure reasons for one case (empty == pass)."""
    fails = []
    low = out.lower()
    for token in case.get("expect", []):
        if token not in out:
            fails.append(f"missing expected {token!r}")
    for token in case.get("forbid", []):
        if token.lower() in low:
            fails.append(f"contains forbidden {token!r}")
    in_words = len(case["input"].split())
    out_words = len(out.split())
    if in_words >= MIN_WORDS_FOR_RATIO and out_words > in_words * MAX_LEN_RATIO:
        fails.append(f"output too long ({out_words}w vs {in_words}w in) — did it answer?")
    return fails


def main() -> int:
    if not (os.environ.get("LANDA_PROXY_URL") and os.environ.get("LANDA_APP_SECRET")):
        print("ERROR: LANDA_PROXY_URL / LANDA_APP_SECRET not set. "
              "Run: set -a && . ./.env && set +a", file=sys.stderr)
        return 2

    corpus = json.loads((REPO / "evals" / "code_category.json").read_text())

    # Fresh default config, force the code category (Cursor frontmost), use the proxy.
    lc.config = copy.deepcopy(lc.DEFAULT_CONFIG)
    lc.config["llm_provider"] = "landa_proxy"
    lc._consume_active_app = lambda: ("Cursor", "")

    passed, failed = 0, 0
    for case in corpus:
        out, _ = lc.reformat_text(case["input"])
        fails = check(case, out)
        if fails:
            failed += 1
            print(f"FAIL {case['id']}: {case['note']}")
            print(f"     in : {case['input']}")
            print(f"     out: {out}")
            for f in fails:
                print(f"      - {f}")
        else:
            passed += 1
            print(f"PASS {case['id']}: {out}")

    print(f"\n{passed}/{passed + failed} passed.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
