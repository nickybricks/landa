"""Domain vocabulary post-correction for Whisper output.

A `.lex` file is a signed, zstd-compressed msgpack blob containing a list of
canonical domain terms (e.g. medical terminology) and a phonetic index. After
Whisper transcribes audio, we look up phonetically-similar candidates for each
recognized word and swap in the canonical term when one scores high enough.

See tasks/lexicons.md for the full design.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import msgpack
import zstandard as zstd
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
    load_pem_private_key,
)


# ---------------------------------------------------------------------------
# Trust root — public key embedded in app, used to verify .lex signatures
# ---------------------------------------------------------------------------

# Empty until we generate real keys for production lexicons. Tests and the
# build helper supply their own keypair, so this can stay empty in dev.
LANDA_LEXICON_PUBLIC_KEY_PEM: bytes = b""


def _load_trust_root() -> Ed25519PublicKey | None:
    if not LANDA_LEXICON_PUBLIC_KEY_PEM:
        return None
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
    key = load_pem_public_key(LANDA_LEXICON_PUBLIC_KEY_PEM)
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("Embedded lexicon public key is not Ed25519")
    return key


# ---------------------------------------------------------------------------
# Kölner Phonetik (German phonetic algorithm)
# ---------------------------------------------------------------------------

def koelner_phonetik(word: str) -> str:
    """Return the Kölner Phonetik code for a German word.

    Reference: https://en.wikipedia.org/wiki/Cologne_phonetics
    """
    if not word:
        return ""
    s = re.sub(r"[^A-Za-zÄÖÜäöüß]", "", word).upper()
    s = s.replace("Ä", "A").replace("Ö", "O").replace("Ü", "U").replace("ß", "SS")
    if not s:
        return ""

    out: list[str] = []
    n = len(s)
    for i, c in enumerate(s):
        prev = s[i - 1] if i > 0 else ""
        nxt = s[i + 1] if i + 1 < n else ""
        # `nxt in "CSZ"` is True for an empty string — guard explicitly.
        nxt_in = lambda chars: bool(nxt) and nxt in chars
        prev_in = lambda chars: bool(prev) and prev in chars
        code = ""
        if c in "AEIJOUY":
            code = "0" if i == 0 else ""
        elif c == "B":
            code = "1"
        elif c == "P":
            code = "3" if nxt == "H" else "1"
        elif c in "DT":
            code = "8" if nxt_in("CSZ") else "2"
        elif c in "FVW":
            code = "3"
        elif c in "GKQ":
            code = "4"
        elif c == "C":
            if i == 0:
                code = "4" if nxt_in("AHKLOQRUX") else "8"
            else:
                if prev_in("SZ"):
                    code = "8"
                elif nxt_in("AHKOQUX"):
                    code = "4"
                else:
                    code = "8"
        elif c == "X":
            code = "48" if not prev_in("CKQ") else "8"
        elif c == "L":
            code = "5"
        elif c in "MN":
            code = "6"
        elif c == "R":
            code = "7"
        elif c in "SZ":
            code = "8"
        elif c == "H":
            code = ""
        out.append(code)

    # Collapse consecutive duplicates, then drop zeros except a leading one.
    flat = "".join(out)
    collapsed = []
    for ch in flat:
        if not collapsed or collapsed[-1] != ch:
            collapsed.append(ch)
    result = collapsed[0] if collapsed and collapsed[0] == "0" else ""
    for ch in collapsed:
        if ch != "0":
            result += ch
    return result


# ---------------------------------------------------------------------------
# .lex format — read and write
# ---------------------------------------------------------------------------

LEX_MAGIC = b"LANDALEX"
LEX_VERSION = 1


def _signed_payload(manifest: dict, phonetic_index: dict, terms: list[dict]) -> bytes:
    """Bytes covered by the signature — must match between writer and verifier."""
    return msgpack.packb(
        {"manifest": manifest, "phonetic_index": phonetic_index, "terms": terms},
        use_bin_type=True,
    )


def write_lex_file(
    path: str | Path,
    manifest: dict,
    terms: list[dict],
    private_key: Ed25519PrivateKey,
) -> None:
    """Build a .lex file. Computes phonetic index from term surfaces."""
    phonetic_index: dict[str, list[int]] = {}
    for idx, term in enumerate(terms):
        surface = term.get("surface", "")
        for token in surface.split():
            key = koelner_phonetik(token)
            if not key:
                continue
            phonetic_index.setdefault(key, []).append(idx)

    payload = _signed_payload(manifest, phonetic_index, terms)
    signature = private_key.sign(payload)

    body = msgpack.packb(
        {
            "manifest": manifest,
            "phonetic_index": phonetic_index,
            "terms": terms,
            "signature": signature,
        },
        use_bin_type=True,
    )
    compressed = zstd.ZstdCompressor(level=10).compress(body)

    Path(path).write_bytes(LEX_MAGIC + bytes([LEX_VERSION]) + compressed)


@dataclass
class Lexicon:
    manifest: dict
    terms: list[dict]
    phonetic_index: dict[str, list[int]]
    surface_set: set[str] = field(default_factory=set)

    @property
    def id(self) -> str:
        return self.manifest.get("id", "")

    @property
    def language(self) -> str:
        return self.manifest.get("language", "")


def load_lexicon(path: str | Path, public_key: Ed25519PublicKey | None = None) -> Lexicon:
    """Load and verify a .lex file. Raises on tampered files when a key is supplied."""
    raw = Path(path).read_bytes()
    if not raw.startswith(LEX_MAGIC):
        raise ValueError(f"Not a Landa lexicon file: {path}")
    if raw[len(LEX_MAGIC)] != LEX_VERSION:
        raise ValueError(f"Unsupported lexicon version: {raw[len(LEX_MAGIC)]}")
    compressed = raw[len(LEX_MAGIC) + 1:]
    body = zstd.ZstdDecompressor().decompress(compressed)
    data = msgpack.unpackb(body, raw=False)

    manifest = data["manifest"]
    terms = data["terms"]
    phonetic_index = data["phonetic_index"]
    signature = data.get("signature")

    verifier = public_key if public_key is not None else _load_trust_root()
    if verifier is not None:
        if not signature:
            raise InvalidSignature("Lexicon is missing a signature")
        verifier.verify(signature, _signed_payload(manifest, phonetic_index, terms))

    surface_set = {t["surface"].lower() for t in terms}
    return Lexicon(manifest=manifest, terms=terms, phonetic_index=phonetic_index, surface_set=surface_set)


# ---------------------------------------------------------------------------
# Correction pipeline
# ---------------------------------------------------------------------------

# Common German words we never try to correct. Tiny on purpose; expand as needed.
_GERMAN_STOPWORDS = frozenset({
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "einem", "einen",
    "und", "oder", "aber", "auch", "ist", "sind", "war", "waren", "sein", "haben", "hat", "hatte",
    "ich", "du", "er", "sie", "es", "wir", "ihr", "mich", "mir", "dich", "dir",
    "in", "im", "an", "am", "auf", "mit", "von", "zu", "zur", "zum", "für", "bei", "nach", "über",
    "nicht", "nur", "noch", "schon", "sehr", "wie", "wenn", "dass", "was", "wer", "wo",
    "ja", "nein", "doch", "mal", "kann", "könnte", "soll", "sollte", "wird", "werden",
})

_WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß]+")


def _edit_distance(a: str, b: str, cap: int = 4) -> int:
    """Damerau-Levenshtein with early exit when distance exceeds cap."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > cap:
        return cap + 1
    # Two-row DP, sufficient for our short words.
    prev2 = list(range(lb + 1))
    prev = [0] * (lb + 1)
    for i in range(1, la + 1):
        prev[0] = i
        row_min = prev[0]
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            prev[j] = min(prev2[j] + 1, prev[j - 1] + 1, prev2[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                prev[j] = min(prev[j], prev2[j - 1] + cost)  # transposition
            row_min = min(row_min, prev[j])
        if row_min > cap:
            return cap + 1
        prev2 = prev[:]
    return prev[lb]


def _preserve_case(original: str, replacement: str) -> str:
    if original.isupper():
        return replacement.upper()
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


@dataclass
class LexiconSet:
    lexicons: list[Lexicon] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._merged_index: dict[str, list[tuple[Lexicon, int]]] = {}
        # Fallback bucket: first-letter → single-token terms. Used when the
        # phonetic key doesn't match exactly (single-char drops/inserts in the
        # middle of a word change the Kölner key).
        self._first_letter_index: dict[str, list[tuple[Lexicon, int]]] = {}
        self._merged_surfaces: set[str] = set()
        for lex in self.lexicons:
            self._merged_surfaces |= lex.surface_set
            for key, idxs in lex.phonetic_index.items():
                bucket = self._merged_index.setdefault(key, [])
                for i in idxs:
                    bucket.append((lex, i))
            for i, term in enumerate(lex.terms):
                surface = term.get("surface", "")
                if not surface or " " in surface:
                    continue
                first = surface[:1].lower()
                if first:
                    self._first_letter_index.setdefault(first, []).append((lex, i))

    @classmethod
    def for_language(cls, paths: Iterable[str | Path], language: str) -> "LexiconSet":
        loaded: list[Lexicon] = []
        for p in paths:
            try:
                lex = load_lexicon(p)
            except Exception as e:
                logging.warning("[lexicon] Failed to load %s: %s", p, e)
                continue
            if lex.language != language:
                continue
            loaded.append(lex)
        return cls(lexicons=loaded)

    def correct(self, text: str, *, max_edit_distance: int = 2, score_threshold: float = 0.55) -> str:
        if not self.lexicons or not text:
            return text

        def replace_word(match: re.Match[str]) -> str:
            word = match.group(0)
            if len(word) < 4:
                return word
            lower = word.lower()
            if lower in _GERMAN_STOPWORDS:
                return word
            if lower in self._merged_surfaces:
                return word  # Whisper already produced the canonical form

            key = koelner_phonetik(word)
            candidates: list[tuple[Lexicon, int]] = []
            if key:
                candidates.extend(self._merged_index.get(key, []))
            # Fallback: same first letter, length within ±2. Cheap edit-distance
            # filter rescues mid-word drops/inserts that shift the phonetic key.
            for lex, idx in self._first_letter_index.get(lower[:1], []):
                surface = lex.terms[idx]["surface"]
                if abs(len(surface) - len(lower)) <= 2:
                    candidates.append((lex, idx))
            if not candidates:
                return word

            best_score = 0.0
            best_surface: str | None = None
            seen: set[tuple[int, int]] = set()
            for lex, idx in candidates:
                dedup = (id(lex), idx)
                if dedup in seen:
                    continue
                seen.add(dedup)
                term = lex.terms[idx]
                surface = term["surface"]
                # Single-token canonical match only in this pass; multi-word terms
                # are handled by the n-gram pass (future work).
                if " " in surface:
                    continue
                dist = _edit_distance(lower, surface.lower(), cap=max_edit_distance)
                if dist > max_edit_distance:
                    continue
                length = max(len(lower), len(surface))
                similarity = 1.0 - (dist / length)
                freq = float(term.get("freq", 0.5))
                score = similarity * (0.5 + 0.5 * freq)
                if score > best_score:
                    best_score = score
                    best_surface = surface

            if best_surface and best_score >= score_threshold:
                return _preserve_case(word, best_surface)
            return word

        return _WORD_RE.sub(replace_word, text)


# ---------------------------------------------------------------------------
# Helpers used by tests and the Phase 2 build script
# ---------------------------------------------------------------------------

def generate_keypair() -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    private_key = Ed25519PrivateKey.generate()
    return private_key, private_key.public_key()


def serialize_private_key(key: Ed25519PrivateKey) -> bytes:
    return key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())


def serialize_public_key(key: Ed25519PublicKey) -> bytes:
    return key.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)


def load_private_key_pem(pem: bytes) -> Ed25519PrivateKey:
    key = load_pem_private_key(pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Not an Ed25519 private key")
    return key
