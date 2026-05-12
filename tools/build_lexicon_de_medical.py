#!/usr/bin/env python3
"""Build the German medical .lex file from staged source data.

Reads:
  tasks/lexicons-data/icd10gm2026syst-meta/Klassifikationsdateien/icd10gm2026syst_kodes.txt
  tasks/lexicons-data/ops2026syst-meta/Klassifikationsdateien/ops2026syst_kodes.txt
  tasks/lexicons-data/German_MeSH_2025.xml          (clinical branches A/C/D/E only)
  tasks/lexicons-data/pnbez-20260105/bezvo.csv
  tasks/lexicons-data/wido_arz_amtl_ATC-Index_2026/Amtliche Fassung des ATC-Index 2026.xlsx

Writes:
  tasks/lexicons-data/build/de.medical.lex

Output is byte-identical for identical inputs. Run twice to confirm.
"""

from __future__ import annotations

import csv
import html
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "tasks" / "lexicons-data"
BUILD = DATA / "build"

sys.path.insert(0, str(REPO / "backend"))
from landa_lexicon import write_lex_file, load_private_key_pem  # noqa: E402

LEXICON_VERSION = "2026.05.1"
LEXICON_ISSUED_AT = "2026-05-09T00:00:00Z"  # fixed for reproducibility

# Drop terms shorter than this. Below 4 chars edit-distance correction is unsafe.
MIN_LEN = 4
# When extracting single tokens from multi-word phrases, demand more length.
MIN_TOKEN_LEN = 6

# Words common enough that we never want them as lexicon entries — they would
# trigger false corrections on everyday text. Kept tight; expand on feedback.
COMMON_GERMAN = frozenset({
    "ohne", "oder", "nicht", "sowie", "anderen", "anderer", "anderes", "andere",
    "durch", "nach", "ueber", "über", "unter", "gegen", "ohne", "bei", "mit",
    "des", "der", "die", "das", "den", "dem", "ein", "eine", "einer", "eines",
    "und", "von", "vom", "zur", "zum", "fuer", "für", "auf", "aus", "als",
    "nicht", "alle", "allen", "aller", "alles", "auch", "ist", "sind", "war",
    "bezeichnete", "bezeichnet", "bezeichnen", "anderenorts", "klassifiziert",
    "klassifizierte", "klassifizierten", "naeher", "näher", "sonstige",
    "sonstiger", "sonstigen", "sonstiges", "akute", "akuter", "akuten", "akutes",
    "chronisch", "chronische", "chronischer", "chronischen", "chronisches",
    "primaer", "primär", "primäre", "primären", "sekundaer", "sekundär",
})

# Allowed MeSH tree branches: Anatomy, Diseases, Drugs/Chemicals, Procedures.
# B = Organisms (taxonomy), F = Psychiatry, G = Phenomena, H = Disciplines, etc.
# are mostly noise for dictation use.
MESH_CLINICAL_PREFIXES = ("A", "C", "D", "E")

# Terms whose normalized form matches this regex are dropped (codes, numbers).
_NOISE_RE = re.compile(r"^[\d\W_]+$")
# A "word" for token splitting / acceptance.
_WORD_RE = re.compile(r"^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]*$")


# ---------------------------------------------------------------------------
# Parsers — each yields raw surface strings. Normalization happens in collect().
# ---------------------------------------------------------------------------

def parse_icd10() -> list[tuple[str, str]]:
    path = DATA / "icd10gm2026syst-meta" / "Klassifikationsdateien" / "icd10gm2026syst_kodes.txt"
    out: list[tuple[str, str]] = []
    # ICD kodes.txt: semicolon-separated, no header. Col 9 (1-indexed) = full Titel.
    with path.open(encoding="latin-1") as f:
        for row in csv.reader(f, delimiter=";"):
            if len(row) < 9:
                continue
            title = row[8].strip()
            if title:
                out.append((title, "icd10"))
    return out


def parse_ops() -> list[tuple[str, str]]:
    path = DATA / "ops2026syst-meta" / "Klassifikationsdateien" / "ops2026syst_kodes.txt"
    out: list[tuple[str, str]] = []
    # OPS kodes.txt: semicolon-separated, no header. Col 9 = full Titel.
    with path.open(encoding="latin-1") as f:
        for row in csv.reader(f, delimiter=";"):
            if len(row) < 9:
                continue
            title = row[8].strip()
            if title:
                out.append((title, "ops"))
    return out


def parse_mesh() -> list[tuple[str, str]]:
    path = DATA / "German_MeSH_2025.xml"
    out: list[tuple[str, str]] = []
    # Stream parse the 400 MB file — only need DescriptorName + TreeNumberList.
    context = ET.iterparse(str(path), events=("end",))
    for _, elem in context:
        if elem.tag != "DescriptorRecord":
            continue
        tree_numbers = [t.text or "" for t in elem.findall(".//TreeNumber")]
        if not any(tn.startswith(MESH_CLINICAL_PREFIXES) for tn in tree_numbers):
            elem.clear()
            continue
        # DescriptorName format: "German[English]". If no German translation,
        # both halves are equal. We want the German half.
        name_str = ""
        n = elem.find("DescriptorName/String")
        if n is not None and n.text:
            name_str = n.text
        if name_str:
            german = name_str.split("[", 1)[0].strip()
            if german:
                out.append((german, "mesh"))
        # Concept names too — they include synonyms.
        for cn in elem.findall(".//ConceptName"):
            s = cn.text or ""
            if s:
                german = s.split("[", 1)[0].strip()
                if german:
                    out.append((german, "mesh"))
        # Skip Term/String: it dumps every bilingual variant (incl. English
        # fallbacks and inflected forms) and brought ~70% of the false
        # corrections in build verification.
        elem.clear()
    return out


def parse_pharmnet() -> list[tuple[str, str]]:
    path = DATA / "pnbez-20260105" / "bezvo.csv"
    out: list[tuple[str, str]] = []
    with path.open(encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            for col in ("HBEZ1", "HBEZ2", "HBEZ3", "SYN", "USYN"):
                raw = (row.get(col) or "").strip().strip('"')
                if not raw or raw == "-":
                    continue
                # SYN/USYN can pipe-separate multiple synonyms.
                for piece in raw.split("|"):
                    cleaned = html.unescape(piece).strip()
                    # Strip trailing parenthetical refs like "(Ph.Eur.)"
                    cleaned = re.sub(r"\s*\([^)]*\)\s*$", "", cleaned).strip()
                    if cleaned:
                        out.append((cleaned, "pharmnet"))
    return out


def parse_atc() -> list[tuple[str, str]]:
    import openpyxl
    path = DATA / "wido_arz_amtl_ATC-Index_2026" / "Amtliche Fassung des ATC-Index 2026.xlsx"
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    ws = wb["Amtl. Index 2026 alph. sortiert"]
    out: list[tuple[str, str]] = []
    for row in ws.iter_rows(values_only=True):
        atc = (row[0] or "").strip() if row[0] else ""
        name = (row[2] or "").strip() if row[2] else ""
        if not name:
            continue
        # Only leaf substances (full ATC codes are 7 chars). Skip categories.
        if len(atc.replace(" ", "")) < 7:
            continue
        out.append((name, "atc"))
    wb.close()
    return out


# ---------------------------------------------------------------------------
# Normalize, dedupe, and emit single-token derivatives.
# ---------------------------------------------------------------------------

def normalize(s: str) -> str:
    s = html.unescape(s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    # Strip trailing punctuation (commas, semis from messy CSV values)
    s = s.rstrip(",;:.")
    return s


def emit_tokens(phrase: str) -> list[str]:
    """Yield significant single tokens from a multi-word phrase.

    Returns capitalized tokens of length >= MIN_TOKEN_LEN that aren't common.
    Lower-cased tokens (verbs, prepositions, etc.) are skipped — German nouns
    are capitalized, so this filter targets the medically meaningful words.
    """
    out: list[str] = []
    for tok in re.split(r"[\s/\-]+", phrase):
        tok = tok.strip(".,;:()[]")
        if not _WORD_RE.match(tok):
            continue
        if len(tok) < MIN_TOKEN_LEN:
            continue
        if not tok[0].isupper():
            continue
        if tok.lower() in COMMON_GERMAN:
            continue
        out.append(tok)
    return out


def collect_terms() -> dict[str, set[str]]:
    """Returns {lowercase_key: {tags}} → preserves first-seen surface form."""
    raw: list[tuple[str, str]] = []
    for fn, label in [
        (parse_icd10, "ICD-10-GM"),
        (parse_ops, "OPS"),
        (parse_mesh, "MeSH"),
        (parse_pharmnet, "PharmNet"),
        (parse_atc, "ATC"),
    ]:
        items = fn()
        print(f"  {label}: {len(items):>7} raw entries")
        raw.extend(items)

    surfaces: dict[str, dict] = {}  # lower → {"surface": ..., "tags": set}

    def add(token: str, tag: str) -> None:
        if len(token) < MIN_LEN:
            return
        if not _WORD_RE.match(token):
            return
        # Drop ALL-CAPS tokens: peptide sequences (SRVLCKRCAL) and chemical
        # abbreviations (HETE) — both unsuitable for phonetic correction and
        # they break case preservation when corrected into mixed-case input.
        if token.isupper() and len(token) > 1:
            return
        if token.lower() in COMMON_GERMAN:
            return
        key = token.lower()
        if key not in surfaces:
            surfaces[key] = {"surface": token, "tags": set()}
        surfaces[key]["tags"].add(tag)

    for s, tag in raw:
        s = normalize(s)
        if not s:
            continue
        # Single-word: add directly. Multi-word: extract significant tokens.
        # The current correct() pass only uses single-token surfaces; multi-word
        # entries would be dead weight until the n-gram pass lands.
        if _WORD_RE.match(s):
            add(s, tag)
        else:
            for tok in emit_tokens(s):
                add(tok, tag)

    return surfaces


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def main() -> int:
    private_key_path = Path.home() / ".findmyvoice" / "landa_lexicon_ed25519.pem"
    if not private_key_path.exists():
        print(f"ERROR: signing key not found at {private_key_path}", file=sys.stderr)
        return 1

    BUILD.mkdir(exist_ok=True)
    out_path = BUILD / "de.medical.lex"

    print("Parsing sources…")
    surfaces = collect_terms()
    print(f"After dedupe: {len(surfaces)} unique terms")

    # Sort by lowercase key, then surface — deterministic.
    keys = sorted(surfaces.keys())
    terms = [
        {
            "surface": surfaces[k]["surface"],
            "freq": 1.0,
            "tags": sorted(surfaces[k]["tags"]),
        }
        for k in keys
    ]

    manifest = {
        "id": "de.medical",
        "name": "Medical",
        "language": "de",
        "version": LEXICON_VERSION,
        "term_count": len(terms),
        "sources": [
            "ICD-10-GM 2026",
            "OPS 2026",
            "German MeSH 2025",
            "PharmNet.Bund 2026-01-05",
            "ATC/WHO amtlich 2026",
        ],
        "issued_at": LEXICON_ISSUED_AT,
    }

    private_key = load_private_key_pem(private_key_path.read_bytes())
    write_lex_file(out_path, manifest, terms, private_key)

    size = out_path.stat().st_size
    print(f"Wrote {out_path} ({size:,} bytes, {len(terms):,} terms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
