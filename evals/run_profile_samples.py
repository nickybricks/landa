#!/usr/bin/env python3
"""Sampler for the everyday profiles (Email + Personal Message).

Unlike the code eval, tone/register quality is subjective — there is no token-based
pass/fail for "does this read like a good email." This script runs a fixed corpus of
realistic raw dictations through the live reformat path and prints input -> output so a
human can blind-rate the result. It DOES auto-check the handful of deterministic
guardrails each case carries (expect/forbid) — e.g. German Sie/du must not flip, and no
invented facts — and reports those loudly.

Run from the repo root with the proxy creds loaded:

    set -a && . ./.env && set +a
    ./backend/venv/bin/python evals/run_profile_samples.py

Needs LANDA_PROXY_URL + LANDA_APP_SECRET. Exits 0 unless a hard guardrail fails.
"""

import copy
import json
import os
import pathlib
import sys
import time

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

import landa_core as lc  # noqa: E402

LANG_CODE = {"English": "en", "German": "de"}
# The proxy rate-limits (Upstash); a fast full run trips it and the backend then returns
# the input UNCHANGED (fallback), producing false "failures". Space the calls out.
CALL_SPACING_S = 2.0


def guardrail_fails(case: dict, out: str) -> list[str]:
    """Only the deterministic checks — never tone. Empty == clean.

    Case-SENSITIVE on purpose: German formal address is defined by capitalization
    (`Sie`/`Ihnen` ≠ `sie`/`ihnen` = "them/her"), so a flip must be caught without
    false-matching the lowercase pronoun.
    """
    fails = []
    for token in case.get("expect", []):
        if token not in out:
            fails.append(f"missing expected {token!r}")
    for token in case.get("forbid", []):
        if token in out:
            fails.append(f"contains forbidden {token!r}")
    return fails


def run_case(case: dict) -> str:
    category, style = case["category"], case["style"]
    lc.config = copy.deepcopy(lc.DEFAULT_CONFIG)
    lc.config["llm_provider"] = "landa_proxy"
    lc.config["openai_language"] = LANG_CODE.get(case["lang"], "auto")
    lc.config.setdefault("modes", {})
    lc.config["modes"]["selections"] = {category: style}
    lc.config["modes"]["toggles"] = {category: {style: case.get("toggles", {})}}
    lc.get_active_category = lambda: category
    # Notes branches plain-vs-Notion on the frontmost app (_is_notion_target).
    # The sampler has no real active app, so drive that branch from a `target`
    # field: "notion" -> Markdown variant, anything else -> plain-text variant.
    lc._is_notion_target = lambda: case.get("target") == "notion"
    out, _ = lc.reformat_text(case["input"])
    return out


def main() -> int:
    if not (os.environ.get("LANDA_PROXY_URL") and os.environ.get("LANDA_APP_SECRET")):
        print("ERROR: LANDA_PROXY_URL / LANDA_APP_SECRET not set. "
              "Run: set -a && . ./.env && set +a", file=sys.stderr)
        return 2

    corpus = json.loads((REPO / "evals" / "everyday_profiles.json").read_text())
    # Optional filter: an argv substring matched against category or id, so a single
    # profile can be sampled without burning proxy calls on the whole corpus.
    if len(sys.argv) > 1:
        needle = sys.argv[1].lower()
        corpus = [c for c in corpus if needle in c["category"].lower() or needle in c["id"].lower()]
        print(f"(filter {sys.argv[1]!r} -> {len(corpus)} cases)")
    guardrail_failed = 0
    fell_back = 0

    for i, case in enumerate(corpus):
        if i:
            time.sleep(CALL_SPACING_S)
        out = run_case(case)
        # The proxy returns the input unchanged on rate-limit/error; flag it so a
        # fallback isn't misread as a real guardrail failure.
        fallback = out.strip() == case["input"].strip()
        fails = [] if fallback else guardrail_fails(case, out)
        tag = case.get("toggles") and f" toggles={case['toggles']}" or ""
        persona = case.get("persona", "")
        mode = case.get("mode", "verbatim")
        mode_tag = "  ⚙ AGENT MODE (should compose, not echo)" if mode == "agent" else ""
        target_tag = f"  📄 target={case['target']}" if case.get("target") else ""
        print(f"\n=== {case['id']} [{case['category']}/{case['style']}/{case['lang']}/{persona}]{tag}{mode_tag}{target_tag} ===")
        print(f"IN : {case['input']}")
        print(f"OUT: {out}")
        print(f"why: {case['note']}")
        if fallback:
            fell_back += 1
            print("  ~~ PROXY FALLBACK: output == input (rate-limited?) — not rated; rerun this case")
        if fails:
            guardrail_failed += 1
            for f in fails:
                print(f"  !! GUARDRAIL {f}")

    print(f"\n{len(corpus)} samples run, {guardrail_failed} with guardrail failures, "
          f"{fell_back} proxy fallbacks (rerun those).")
    return 1 if guardrail_failed else 0


if __name__ == "__main__":
    sys.exit(main())
