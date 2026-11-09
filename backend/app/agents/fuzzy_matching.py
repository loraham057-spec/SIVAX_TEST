"""
Fuzzy matching utilities — phonetic + token-level similarity for misspelled names.

Standard SequenceMatcher (character-level ratio) misses common phonetic
deformations in DRC place names:
    - "Lwalaba" vs "Lualaba"     (consonant transposition)
    - "Kasay" vs "Kasaï"          (accent drop + truncation)
    - "Ekuateur" vs "Équateur"   (phonetic spelling)
    - "Cuapa" vs "Tshuapa"       (consonant cluster simplification)

This module combines three signals and takes the max:
    1. SequenceMatcher ratio (character-level)
    2. Bigram Jaccard similarity (captures token-level overlap)
    3. Phonetic similarity (French-adapted Soundex)

No external dependencies — pure stdlib.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _bigrams(text: str) -> set[str]:
    """Character bigrams of a string (padded). 'lualaba' → {'lu','ua','al','la','ab','ba'}."""
    s = text.replace(" ", "")
    if len(s) < 2:
        return {s} if s else set()
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _bigram_similarity(a: str, b: str) -> float:
    """Jaccard similarity on character bigrams."""
    ba, bb = _bigrams(a), _bigrams(b)
    if not ba or not bb:
        return 0.0
    return len(ba & bb) / len(ba | bb)


# ─── French-adapted Soundex ───────────────────────────────
# Maps common French/DRC phonetic patterns to digits, then compares codes.

_PHONETIC_MAP = {
    # BP → 1
    "b": "1", "p": "1",
    # CKQ → 2
    "c": "2", "k": "2", "q": "2",
    # DT → 3
    "d": "3", "t": "3",
    # L → 4
    "l": "4",
    # MN → 5
    "m": "5", "n": "5",
    # R → 6
    "r": "6",
    # GJ → 7
    "g": "7", "j": "7",
    # SZ (soft) → 8
    "s": "8", "z": "8",
    # FV → 9
    "f": "9", "v": "9",
    # H, W, Y, vowels → 0 (dropped in code but kept for first-letter)
    "h": "0", "w": "0", "y": "0",
}

# Common DRC phonetic substitutions (applied before Soundex)
_PHONETIC_SUBS = [
    (r"tsh", "ch"),   # Tshuapa → Chuapa
    (r"ts", "s"),     # Tshopo → Shopo
    (r"kw", "k"),     # Kwango → Kango
    (r"mb", "m"),     # Maindombe → Maindome
    (r"ng", "n"),     # Fungurume → Funurume
    (r"nn", "n"),     # double consonants
    (r"ll", "l"),
    (r"mm", "m"),
    (r"ss", "s"),
    (r"tt", "t"),
    (r"pp", "p"),
    (r"cc", "c"),
    (r"dd", "d"),
    (r"rr", "r"),
    (r"ww", "w"),
    (r"ph", "f"),     # phonetic
    (r"th", "t"),
    (r"kh", "k"),
    (r"gh", "g"),
    (r"rh", "r"),
    (r"oh", "o"),
    (r"ah", "a"),
    (r"eh", "e"),
    (r"ih", "i"),
    (r"uh", "u"),
    (r"yh", "i"),
    (r"wh", "w"),
]


def _phonetic_code(text: str) -> str:
    """French-adapted Soundex: first letter + 3 consonant digits."""
    s = strip_accents(text).lower()
    for pattern, replacement in _PHONETIC_SUBS:
        s = re.sub(pattern, replacement, s)
    s = re.sub(r"[^a-z]", "", s)
    if not s:
        return ""
    first = s[0]
    digits = []
    for ch in s[1:]:
        d = _PHONETIC_MAP.get(ch, "0")
        if d != "0" and (not digits or digits[-1] != d):
            digits.append(d)
        if len(digits) >= 3:
            break
    return (first + "".join(digits)).ljust(4, "0")[:4]


def _phonetic_similarity(a: str, b: str) -> float:
    """1.0 if same Soundex code, else 0. Partial credit for shared prefix."""
    ca, cb = _phonetic_code(a), _phonetic_code(b)
    if not ca or not cb:
        return 0.0
    if ca == cb:
        return 1.0
    # Partial credit: first 2 chars match (same first letter + first consonant)
    if ca[:2] == cb[:2]:
        return 0.5
    return 0.0


def fuzzy_similarity(a: str, b: str) -> float:
    """Combined fuzzy similarity score in [0, 1].

    Takes the max of character-level, bigram, and phonetic similarity,
    BUT discounts phonetic-only matches: when the phonetic score is high
    but both character and bigram scores are low, the words sound similar
    but are spelled very differently — likely a false positive (e.g.
    "mutena" vs "mutwanga" share the Soundex code m350 but are different
    words).
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    char_score = SequenceMatcher(None, a, b).ratio()
    bigram_score = _bigram_similarity(a, b)
    phon_score = _phonetic_similarity(a, b)
    final = max(char_score, bigram_score, phon_score)
    # Phonetic-only penalty: if phonetic is the dominant signal and the
    # other two scores are significantly lower, average instead of max.
    # This preserves genuine misspellings (lwalaba→lualaba: seq=0.86,
    # bigram=0.5) while rejecting sound-alike false positives
    # (mutena→mutwanga: seq=0.71, bigram=0.2).
    if phon_score > char_score + 0.2 and phon_score > bigram_score + 0.2:
        final = (char_score + bigram_score + phon_score) / 3
    return final


def best_fuzzy_match(query: str, candidates: list[str], threshold: float = 0.72) -> list[tuple[str, float]]:
    """Return [(candidate, score)] sorted by descending score, above threshold."""
    scored = [(c, fuzzy_similarity(query, c)) for c in candidates]
    scored = [(c, s) for c, s in scored if s >= threshold]
    scored.sort(key=lambda x: -x[1])
    return scored
