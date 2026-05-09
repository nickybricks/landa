"""Phase 1 tests for the lexicon format + post-correction engine."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidSignature

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from landa_lexicon import (
    Lexicon,
    LexiconSet,
    generate_keypair,
    koelner_phonetik,
    load_lexicon,
    write_lex_file,
)


# Hand-built sample of common German medical terms. These are the canonical
# forms; tests feed the engine misrecognized variants and expect recovery.
SAMPLE_TERMS = [
    {"surface": "Myokardinfarkt", "freq": 0.9, "tags": ["icd10"]},
    {"surface": "Hypertonie", "freq": 0.95, "tags": ["icd10"]},
    {"surface": "Diabetes", "freq": 0.95, "tags": ["icd10"]},
    {"surface": "Cholezystektomie", "freq": 0.7, "tags": ["ops"]},
    {"surface": "Pneumonie", "freq": 0.9, "tags": ["icd10"]},
    {"surface": "Tachykardie", "freq": 0.85, "tags": ["icd10"]},
    {"surface": "Bradykardie", "freq": 0.8, "tags": ["icd10"]},
    {"surface": "Nephritis", "freq": 0.7, "tags": ["icd10"]},
    {"surface": "Hepatitis", "freq": 0.85, "tags": ["icd10"]},
    {"surface": "Gastritis", "freq": 0.85, "tags": ["icd10"]},
    {"surface": "Anämie", "freq": 0.85, "tags": ["icd10"]},
    {"surface": "Arthrose", "freq": 0.85, "tags": ["icd10"]},
    {"surface": "Migräne", "freq": 0.9, "tags": ["icd10"]},
    {"surface": "Asthma", "freq": 0.9, "tags": ["icd10"]},
    {"surface": "Bronchitis", "freq": 0.85, "tags": ["icd10"]},
    {"surface": "Sinusitis", "freq": 0.7, "tags": ["icd10"]},
    {"surface": "Otitis", "freq": 0.6, "tags": ["icd10"]},
    {"surface": "Appendizitis", "freq": 0.75, "tags": ["icd10"]},
    {"surface": "Ibuprofen", "freq": 0.95, "tags": ["pharma"]},
    {"surface": "Paracetamol", "freq": 0.95, "tags": ["pharma"]},
    {"surface": "Metformin", "freq": 0.85, "tags": ["pharma"]},
    {"surface": "Amoxicillin", "freq": 0.85, "tags": ["pharma"]},
]

SAMPLE_MANIFEST = {
    "id": "de.medical.test",
    "name": "Medical (Test)",
    "language": "de",
    "version": "0.0.1",
    "term_count": len(SAMPLE_TERMS),
    "sources": ["test fixture"],
}


@pytest.fixture
def keypair():
    return generate_keypair()


@pytest.fixture
def lex_path(tmp_path, keypair):
    private_key, _ = keypair
    path = tmp_path / "test.lex"
    write_lex_file(path, SAMPLE_MANIFEST, SAMPLE_TERMS, private_key)
    return path


def test_koelner_phonetik_matches_known_codes():
    # Reference values from the Wikipedia article on Cologne phonetics.
    assert koelner_phonetik("Müller") == "657"
    assert koelner_phonetik("Schmidt") == "862"
    assert koelner_phonetik("Meier") == "67"
    assert koelner_phonetik("") == ""


def test_phonetically_similar_german_words_share_keys():
    # Whisper substitutions of phonetically-equivalent letters should collide.
    assert koelner_phonetik("Hypertonie") == koelner_phonetik("Hyperthonie")
    assert koelner_phonetik("Tachykardie") == koelner_phonetik("Tachycardie")
    assert koelner_phonetik("Cholezystektomie") == koelner_phonetik("Cholezistektomie")


def test_loads_valid_signed_file(lex_path, keypair):
    _, public_key = keypair
    lex = load_lexicon(lex_path, public_key=public_key)
    assert isinstance(lex, Lexicon)
    assert lex.id == "de.medical.test"
    assert lex.language == "de"
    assert len(lex.terms) == len(SAMPLE_TERMS)


def test_rejects_tampered_file(lex_path, keypair, tmp_path):
    _, public_key = keypair
    raw = lex_path.read_bytes()
    # Flip a byte deep in the compressed payload.
    bad = bytearray(raw)
    bad[len(raw) - 50] ^= 0xFF
    tampered = tmp_path / "tampered.lex"
    tampered.write_bytes(bytes(bad))
    with pytest.raises(Exception):  # zstd error or InvalidSignature
        load_lexicon(tampered, public_key=public_key)


def test_rejects_signature_from_wrong_key(lex_path):
    # Sign with key A, verify with key B → must fail.
    _, other_pub = generate_keypair()
    with pytest.raises(InvalidSignature):
        load_lexicon(lex_path, public_key=other_pub)


def test_correction_recovers_misspelled_terms(lex_path, keypair):
    _, public_key = keypair
    lex = load_lexicon(lex_path, public_key=public_key)
    lset = LexiconSet([lex])

    # Each input is a plausible Whisper output; expected is the canonical term.
    cases = [
        ("Der Patient hat einen Myokardinfakt erlitten.", "Myokardinfarkt"),
        ("Die Patientin leidet an Hyperthonie.", "Hypertonie"),
        ("Diagnose: Pneumoni rechtsseitig.", "Pneumonie"),
        ("Verdacht auf Tachycardie.", "Tachykardie"),
        ("Akute Bronchidis seit drei Tagen.", "Bronchitis"),
        ("Verschreibung: Ibuprofin 400mg.", "Ibuprofen"),
        ("Patient nimmt Metformine täglich.", "Metformin"),
        ("Akute Appendizidis.", "Appendizitis"),
        ("Chronische Gastridis.", "Gastritis"),
        ("Migräneanfall heute Morgen.", "Migräne"),
    ]
    recovered = 0
    for sentence, expected in cases:
        out = lset.correct(sentence)
        if expected in out:
            recovered += 1
    # Should recover the strong majority. Threshold is loose because the engine
    # is conservative by design — false corrections are worse than misses.
    assert recovered >= 7, f"only recovered {recovered}/{len(cases)}: review thresholds"


def test_does_not_corrupt_everyday_german(lex_path, keypair):
    _, public_key = keypair
    lex = load_lexicon(lex_path, public_key=public_key)
    lset = LexiconSet([lex])

    control_sentences = [
        "Ich gehe heute Abend ins Kino.",
        "Das Wetter ist sehr schön heute.",
        "Können wir uns morgen treffen?",
        "Der Zug fährt um halb acht ab.",
        "Bitte schicke mir die Unterlagen per E-Mail.",
        "Wir haben gestern im Restaurant gegessen.",
        "Mein neuer Computer ist viel schneller.",
        "Die Konferenz beginnt um neun Uhr.",
    ]
    for s in control_sentences:
        assert lset.correct(s) == s, f"false correction on: {s!r}"


def test_empty_set_is_passthrough():
    assert LexiconSet([]).correct("Some text here.") == "Some text here."


def test_preserves_case(lex_path, keypair):
    _, public_key = keypair
    lex = load_lexicon(lex_path, public_key=public_key)
    lset = LexiconSet([lex])
    out = lset.correct("MYOKARDINFAKT bestätigt.")
    assert "MYOKARDINFARKT" in out or "Myokardinfarkt" in out
