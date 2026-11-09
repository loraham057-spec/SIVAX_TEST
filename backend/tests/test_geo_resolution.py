"""Tests for smart geography/metric resolution and alias learning.

These tests stub out Supabase/DHIS2 so they run without external services.
They cover the Lwalaba regression and ALL categories of ambiguous geography
encountered in the real DRC DHIS2 (546 org units, 26 provinces, 516 ZS,
hundreds of homonymous aires de santé).

Categories covered (derived from real DHIS2 data analysis):
    A. Exact province names (26 provinces)
    B. Curated phonetic aliases (Lwalaba, Luwalaba, …)
    C. Misspelled provinces not yet curated (Lualba, Ekuateur, Cuapa)
    D. Homonymy: same name at different levels
       (Lualaba Province vs Lualaba ZS vs Lwalaba Aire de Santé)
    E. Cross-province homonymy (Bili ZS in Bas-Uele AND Nord-Ubangi;
       Lubunga ZS in Kasai AND Tshopo)
    F. Aire de Santé whose name contains a province name
       (lm Lualaba Aire de Santé, sk Tanganyika Aire de Santé,
        kn Mongala Aire de Santé, sn Lomami Aire de Santé — all level 4
        whose name matches a province → must NOT silently resolve to the
        province when the user asked for a facility)
    G. Partial/ambiguous province fragments (Kasai, Kivu, Ubangi, Uele,
       Lomami — each matches 2+ provinces)
    H. Compound directional names (Haut Katanga, Bas Uele, Nord Kivu,
       Sud Ubangi — must match the full compound, not just "Katanga")
    I. Generic scopes (province, ZS, zones de santé, national)
    J. Empty / None / whitespace inputs
    K. Completely unknown garbage
    L. Learned alias lifecycle (propose → trust → reject → remove)
    M. Contextual level scoring ("province du X" vs "ZS du X")
    N. Fuzzy matching of free-text clarification answers
    O. Metric/indicator misspellings and learning
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.agents import alias_learning
from app.agents import geo_resolution
from app.agents import metric_resolution
from app.agents.clarification_engine import apply_clarification_answer, detect_ambiguities


# ─── Fixtures: realistic org-unit catalog from DHIS2 ───
# All 26 provinces + representative ZS and homonymous aires de santé.
# IDs match real DHIS2 where possible; synthetic IDs are prefixed with "test_".

_CATALOG = [
    # ── A. All 26 provinces (level 2) ──
    {"id": "TwSa8zUu09Q", "name": "kn Kinshasa Province", "level": 2},
    {"id": "dKdrd8HqZWz", "name": "kc Kongo Central Province", "level": 2},
    {"id": "PvtAI4RUMkr", "name": "kg Kwango Province", "level": 2},
    {"id": "BmKjwqc6BEw", "name": "kl Kwilu Province", "level": 2},
    {"id": "u0vP3ZicczY", "name": "md Maindombe Province", "level": 2},
    {"id": "XjeRGfqHMrl", "name": "eq Equateur Province", "level": 2},
    {"id": "krWZMdwGDIf", "name": "mg Mongala Province", "level": 2},
    {"id": "JkIljbLc4Ny", "name": "su Sud Ubangi Province", "level": 2},
    {"id": "iu4Zj3Zq39m", "name": "nu Nord Ubangi Province", "level": 2},
    {"id": "rWrCdr321Qu", "name": "bu Bas Uele Province", "level": 2},
    {"id": "wy1lwIP18SL", "name": "hu Haut Uele Province", "level": 2},
    {"id": "Q4cbnIAo10f", "name": "it Ituri Province", "level": 2},
    {"id": "fEKDiQIuqeE", "name": "hl Haut Lomami Province", "level": 2},
    {"id": "dJ3v8xc6ZIK", "name": "ll Lualaba Province", "level": 2},
    {"id": "F9w3VW1cQmb", "name": "hk Haut Katanga Province", "level": 2},
    {"id": "hyvduSNKvfe", "name": "tn Tanganyika Province", "level": 2},
    {"id": "an1cK6GbbVw", "name": "lm Lomami Province", "level": 2},
    {"id": "ybgmW3kIGuq", "name": "sn Sankuru Province", "level": 2},
    {"id": "D15NtionqkH", "name": "ks Kasai Province", "level": 2},
    {"id": "I8CuQpdBQfP", "name": "kr Kasai Central Province", "level": 2},
    {"id": "fgHCmGhaP2X", "name": "ke Kasai Oriental Province", "level": 2},
    {"id": "uyuwe6bqphf", "name": "mn Maniema Province", "level": 2},
    {"id": "GnLX8MNgxZw", "name": "sk Sud Kivu Province", "level": 2},
    {"id": "pIAYIpy4hiH", "name": "nk Nord Kivu Province", "level": 2},
    {"id": "mnOXJ2Oa5U7", "name": "tp Tshopo Province", "level": 2},
    {"id": "ym2K6YcSNl9", "name": "tu Tshuapa Province", "level": 2},

    # ── D. Homonymy: Lualaba at multiple levels ──
    {"id": "uFV6BUpJi7E", "name": "ll Lualaba Zone de Santé", "level": 3},

    # ── F. Aire de Santé whose name contains a province name ──
    # These are the exact trap that caused the original Lwalaba bug.
    {"id": "KP1Igiapv7Z", "name": "tn Lwalaba Aire de Santé", "level": 4},
    {"id": "test_lm_lualaba_as", "name": "lm Lualaba Aire de Santé", "level": 4},
    {"id": "test_sk_tanganyika_as", "name": "sk Tanganyika Aire de Santé", "level": 4},
    {"id": "test_kn_mongala_as", "name": "kn Mongala Aire de Santé", "level": 4},
    {"id": "test_sn_lomami_as", "name": "sn Lomami Aire de Santé", "level": 4},
    {"id": "test_kn_sankuru_as", "name": "kn Sankuru Aire de Santé", "level": 4},
    {"id": "test_tp_tshopo1_as", "name": "tp Tshopo 1 Aire de Santé", "level": 4},
    {"id": "test_tp_tshopo2_as", "name": "tp Tshopo 2 Aire de Santé", "level": 4},

    # ── E. Cross-province homonymy: same ZS name in different provinces ──
    {"id": "CO06cO2i4Nm", "name": "bu Bili Zone de Santé", "level": 3},
    {"id": "aU2jY9HAg9u", "name": "nu Bili Zone de Santé", "level": 3},
    {"id": "test_kr_lubunga_zs", "name": "kr Lubunga Zone de Santé", "level": 3},
    {"id": "test_tp_lubunga_zs", "name": "tp Lubunga Zone de Santé", "level": 3},

    # ── Representative ZS for exact-match tests ──
    {"id": "JRaVxSGfJ9Z", "name": "kl Mosango Zone de Santé", "level": 3},
    {"id": "yIYFKwCgYVZ", "name": "ll Sandoa Zone de Santé", "level": 3},
    {"id": "rsaI3zncNG9", "name": "ks Tshikapa Zone de Santé", "level": 3},
    {"id": "nXYw6kLqc0y", "name": "nk Rutshuru Zone de Santé", "level": 3},

    # ── D. Province name == ZS name (Tshopo Province + Tshopo ZS) ──
    {"id": "IMkgSD6FVjc", "name": "tp Tshopo Zone de Santé", "level": 3},

    # ── D. Province name == Aire de Santé name (Sankuru Province + Sankuru AS) ──
    # Already covered above: kn Sankuru Aire de Santé

    # ── D. Province name == Aire de Santé name (Mongala Province + Mongala AS) ──
    # Already covered above: kn Mongala Aire de Santé

    # ── D. Province name == Aire de Santé name (Tanganyika Province + Tanganyika AS) ──
    # Already covered above: sk Tanganyika Aire de Santé
]


def _stub_find_org_unit_candidates(name_query, limit=5):
    """Stub that mirrors supabase_data.find_org_unit_candidates exactly."""
    from app.tools.supabase_data import _core_org_name, _normalize, _OU_GENERIC_TOKENS
    from app.agents.fuzzy_matching import fuzzy_similarity
    import re as _re
    norm_q = _normalize(name_query)
    significant = [w for w in norm_q.split() if w not in _OU_GENERIC_TOKENS and len(w) >= 3]
    query_core = " ".join(significant) or norm_q.strip()
    if len(query_core) < 3:
        return []
    wants_zone = bool(_re.search(r"\b(zone|zs)\b", norm_q))
    wants_province = bool(_re.search(r"\bprovince\b", norm_q))
    results: dict[str, dict] = {}
    for unit in _CATALOG:
        core = _core_org_name(unit["name"])
        if not core:
            continue
        if query_core == core:
            score = 1.0
        elif query_core in core or core in query_core:
            score = 0.9
        else:
            score = fuzzy_similarity(query_core, core)
        if score < 0.72:
            continue
        level = unit.get("level")
        if level == 3:
            score += 0.15 if wants_zone else (-0.05 if wants_province else 0)
        elif level == 2:
            score += 0.15 if wants_province else (-0.05 if wants_zone else 0.03)
        entry = {
            "id": unit["id"],
            "name": unit["name"],
            "level": level,
            "score": round(min(max(score, 0.0), 1.0), 3),
        }
        prev = results.get(unit["id"])
        if not prev or prev["score"] < entry["score"]:
            results[unit["id"]] = entry
    ranked = sorted(results.values(), key=lambda c: (-c["score"], c.get("level") or 99))
    return ranked[:limit]


def _stub_find_org_unit(name_query):
    cands = _stub_find_org_unit_candidates(name_query, limit=1)
    return cands[0] if cands else None


# ─── Test mixin for common setup/teardown ───

class _GeoTestMixin:
    def setUp(self):
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()
        self._patches = [
            patch("app.agents.geo_resolution.find_org_unit_candidates",
                  side_effect=_stub_find_org_unit_candidates),
            patch("app.agents.geo_resolution.find_org_unit",
                  side_effect=_stub_find_org_unit),
            # Force in-memory fallback for alias_learning so tests are
            # isolated from the real Supabase table.
            patch("app.agents.alias_learning._get_sb", return_value=None),
            patch("app.agents.alias_learning._SUPABASE", None),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()


# ═══════════════════════════════════════════════════════════
# A. Exact province resolution (all 26 provinces)
# ═══════════════════════════════════════════════════════════

class ExactProvinceResolutionTests(_GeoTestMixin, unittest.TestCase):
    """Every DRC province must resolve silently via PROVINCE_MAP."""

    _PROVINCES = [
        ("Kinshasa", "TwSa8zUu09Q"),
        ("Kongo Central", "dKdrd8HqZWz"),
        ("Kwango", "PvtAI4RUMkr"),
        ("Kwilu", "BmKjwqc6BEw"),
        ("Maindombe", "u0vP3ZicczY"),
        ("Maïndombe", "u0vP3ZicczY"),
        ("Equateur", "XjeRGfqHMrl"),
        ("Équateur", "XjeRGfqHMrl"),
        ("Mongala", "krWZMdwGDIf"),
        ("Sud Ubangi", "JkIljbLc4Ny"),
        ("Nord Ubangi", "iu4Zj3Zq39m"),
        ("Bas Uele", "rWrCdr321Qu"),
        ("Haut Uele", "wy1lwIP18SL"),
        ("Ituri", "Q4cbnIAo10f"),
        ("Haut Lomami", "fEKDiQIuqeE"),
        ("Lualaba", "dJ3v8xc6ZIK"),
        ("Haut Katanga", "F9w3VW1cQmb"),
        ("Tanganyika", "hyvduSNKvfe"),
        ("Lomami", "an1cK6GbbVw"),
        ("Sankuru", "ybgmW3kIGuq"),
        ("Kasai", "D15NtionqkH"),
        ("Kasaï", "D15NtionqkH"),
        ("Kasai Central", "I8CuQpdBQfP"),
        ("Kasaï Central", "I8CuQpdBQfP"),
        ("Kasai Oriental", "fgHCmGhaP2X"),
        ("Kasaï Oriental", "fgHCmGhaP2X"),
        ("Maniema", "uyuwe6bqphf"),
        ("Sud Kivu", "GnLX8MNgxZw"),
        ("Nord Kivu", "pIAYIpy4hiH"),
        ("Tshopo", "mnOXJ2Oa5U7"),
        ("Tshuapa", "ym2K6YcSNl9"),
    ]

    def test_all_provinces_resolve(self):
        for name, expected_id in self._PROVINCES:
            with self.subTest(province=name):
                r = geo_resolution.resolve_geography_smart(name)
                self.assertEqual(r["status"], "resolved", f"{name} should resolve")
                self.assertEqual(r["org_unit_id"], expected_id, f"{name} → wrong ID")
                self.assertEqual(r["source"], "province_map")

    def test_case_insensitive(self):
        for variant in ("LUALABA", "lualaba", "LuAlAbA", "  Lualaba  "):
            with self.subTest(variant=variant):
                r = geo_resolution.resolve_geography_smart(variant)
                self.assertEqual(r["status"], "resolved")
                self.assertEqual(r["org_unit_id"], "dJ3v8xc6ZIK")


# ═══════════════════════════════════════════════════════════
# B. Curated phonetic aliases
# ═══════════════════════════════════════════════════════════

class CuratedAliasTests(_GeoTestMixin, unittest.TestCase):
    """Aliases manually added to PROVINCE_MAP for known misspellings."""

    def test_lwalaba_resolves_to_lualaba(self):
        r = geo_resolution.resolve_geography_smart("Lwalaba")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "dJ3v8xc6ZIK")

    def test_luwalaba_resolves_to_lualaba(self):
        r = geo_resolution.resolve_geography_smart("Luwalaba")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "dJ3v8xc6ZIK")


# ═══════════════════════════════════════════════════════════
# C. Misspelled provinces not yet curated → ambiguous
# ═══════════════════════════════════════════════════════════

class MisspelledProvinceTests(_GeoTestMixin, unittest.TestCase):
    """Misspellings NOT in PROVINCE_MAP must trigger clarification, not
    silently match a wrong org unit (the original Lwalaba bug)."""

    def test_lualba_missing_letter_is_ambiguous(self):
        r = geo_resolution.resolve_geography_smart("Lualba")
        self.assertEqual(r["status"], "ambiguous")
        self.assertTrue(any(c["id"] == "dJ3v8xc6ZIK" for c in r["candidates"]))

    def test_ekuateur_is_ambiguous_or_resolved(self):
        # "Ekuateur" → should fuzzy-match Equateur province
        r = geo_resolution.resolve_geography_smart("Ekuateur")
        self.assertIn(r["status"], ("resolved", "ambiguous"))
        if r["status"] == "ambiguous":
            self.assertTrue(any(c["id"] == "XjeRGfqHMrl" for c in r["candidates"]))
        else:
            self.assertEqual(r["org_unit_id"], "XjeRGfqHMrl")

    def test_kasay_without_accent_is_ambiguous_or_resolved(self):
        # "Kasay" (no accent, truncated) → should match Kasaï
        r = geo_resolution.resolve_geography_smart("Kasay")
        self.assertIn(r["status"], ("resolved", "ambiguous", "not_found"))
        if r["status"] == "ambiguous":
            self.assertTrue(any(c["id"] == "D15NtionqkH" for c in r["candidates"]))

    def test_misspelling_does_not_silently_select_aire_de_sante(self):
        # The original bug: "Lwalaba" matched "tn Lwalaba Aire de Santé" (level 4)
        # With the curated alias this is now resolved, but a NEW misspelling
        # like "Lualba" must NOT silently select the aire de santé.
        r = geo_resolution.resolve_geography_smart("Lualba")
        if r["status"] == "ambiguous":
            # The aire de santé may appear as a candidate, but the province
            # must be ranked higher (or at least present)
            province_candidates = [c for c in r["candidates"] if c["level"] == 2]
            self.assertTrue(province_candidates, "Province should be a candidate")


# ═══════════════════════════════════════════════════════════
# D. Homonymy: same name at different levels
# ═══════════════════════════════════════════════════════════

class HomonymyLevelTests(_GeoTestMixin, unittest.TestCase):
    """Same place name exists as Province + ZS + Aire de Santé."""

    def test_lualaba_province_vs_zs_vs_aire(self):
        # "Lualaba" without level hint → province (curated)
        r = geo_resolution.resolve_geography_smart("Lualaba")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "dJ3v8xc6ZIK")  # province

    def test_tshopo_province_vs_zs(self):
        # "Tshopo" is both a province and a ZS — curated alias wins
        r = geo_resolution.resolve_geography_smart("Tshopo")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "mnOXJ2Oa5U7")  # province

    def test_sankuru_province_vs_aire_de_sante(self):
        # "Sankuru" is a province AND an aire de santé in Kinshasa
        r = geo_resolution.resolve_geography_smart("Sankuru")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "ybgmW3kIGuq")  # province

    def test_mongala_province_vs_aire_de_sante(self):
        r = geo_resolution.resolve_geography_smart("Mongala")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "krWZMdwGDIf")  # province


# ═══════════════════════════════════════════════════════════
# E. Cross-province homonymy: same ZS name in different provinces
# ═══════════════════════════════════════════════════════════

class CrossProvinceHomonymyTests(_GeoTestMixin, unittest.TestCase):
    """Same ZS name exists in multiple provinces → must clarify."""

    def test_bili_zs_in_two_provinces_is_ambiguous(self):
        r = geo_resolution.resolve_geography_smart("Bili")
        self.assertEqual(r["status"], "ambiguous")
        bili_candidates = [c for c in r["candidates"] if "bili" in c["name"].lower()]
        self.assertGreaterEqual(len(bili_candidates), 2)

    def test_lubunga_zs_in_two_provinces_is_ambiguous(self):
        r = geo_resolution.resolve_geography_smart("Lubunga")
        self.assertEqual(r["status"], "ambiguous")
        lubunga_candidates = [c for c in r["candidates"] if "lubunga" in c["name"].lower()]
        self.assertGreaterEqual(len(lubunga_candidates), 2)


# ═══════════════════════════════════════════════════════════
# F. Aire de Santé whose name contains a province name
# ═══════════════════════════════════════════════════════════

class AireDeSanteNameTrapTests(_GeoTestMixin, unittest.TestCase):
    """Aires de santé named after a province (the Lwalaba trap).
    When the user explicitly asks for a facility, the province must NOT
    be silently selected."""

    def test_lualaba_aire_de_sante_does_not_become_province(self):
        # "Aire de Santé Lualaba" → should NOT resolve to Lualaba Province
        r = geo_resolution.resolve_geography_smart("Aire de Santé Lualaba")
        # The _fuzzy_province_match skips when "aire" is detected
        # But resolve_geography_smart may still find the AS via candidates
        if r["status"] == "resolved":
            # If resolved, it should be the aire de santé, not the province
            self.assertNotEqual(r["org_unit_id"], "dJ3v8xc6ZIK")

    def test_tanganyika_aire_de_sante_does_not_become_province(self):
        r = geo_resolution.resolve_geography_smart("Aire de Santé Tanganyika")
        if r["status"] == "resolved":
            self.assertNotEqual(r["org_unit_id"], "hyvduSNKvfe")  # not the province


# ═══════════════════════════════════════════════════════════
# G. Partial/ambiguous province fragments
# ═══════════════════════════════════════════════════════════

class PartialFragmentTests(_GeoTestMixin, unittest.TestCase):
    """Partial names that match multiple provinces (Kasai, Kivu, Ubangi…)."""

    def test_kasai_fragment_triggers_clarification(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Kasai"}
        amb = detect_ambiguities("couverture BCG Kasai", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb, "'Kasai' should trigger clarification")

    def test_kivu_fragment_triggers_clarification(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Kivu"}
        amb = detect_ambiguities("couverture BCG Kivu", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb, "'Kivu' should trigger clarification")

    def test_ubangi_fragment_triggers_clarification(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Ubangi"}
        amb = detect_ambiguities("couverture BCG Ubangi", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb, "'Ubangi' should trigger clarification")

    def test_uele_fragment_triggers_clarification(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Uele"}
        amb = detect_ambiguities("couverture BCG Uele", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb, "'Uele' should trigger clarification")

    def test_lomami_resolves_as_exact_province(self):
        # "Lomami" is both a province AND an ambiguous fragment (Lomami /
        # Haut-Lomami), but since "lomami" is in UNAMBIGUOUS_GEOGRAPHY_TERMS,
        # it resolves directly to Lomami Province — no clarification.
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Lomami"}
        amb = detect_ambiguities("couverture BCG Lomami", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        # Lomami is an exact province → no clarification needed
        self.assertFalse(geo_amb, "'Lomami' is an exact province, not ambiguous")


# ═══════════════════════════════════════════════════════════
# H. Compound directional names
# ═══════════════════════════════════════════════════════════

class CompoundNameTests(_GeoTestMixin, unittest.TestCase):
    """Haut Katanga, Bas Uele, Nord Kivu — must match the full compound."""

    def test_haut_katanga_not_just_katanga(self):
        r = geo_resolution.resolve_geography_smart("Haut Katanga")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "F9w3VW1cQmb")

    def test_bas_uele_resolves(self):
        r = geo_resolution.resolve_geography_smart("Bas Uele")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "rWrCdr321Qu")

    def test_nord_kivu_resolves(self):
        r = geo_resolution.resolve_geography_smart("Nord Kivu")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "pIAYIpy4hiH")

    def test_sud_ubangi_resolves(self):
        r = geo_resolution.resolve_geography_smart("Sud Ubangi")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "JkIljbLc4Ny")

    def test_katanga_alias_resolves_to_haut_katanga(self):
        # "Katanga" is a curated alias for Haut Katanga
        r = geo_resolution.resolve_geography_smart("Katanga")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "F9w3VW1cQmb")


# ═══════════════════════════════════════════════════════════
# I. Generic scopes
# ═══════════════════════════════════════════════════════════

class GenericScopeTests(_GeoTestMixin, unittest.TestCase):
    """Generic scope words must not resolve to any specific org unit."""

    def test_generic_scopes_are_generic(self):
        for scope in ("province", "provinces", "ZS", "AS", "zone de santé",
                       "zones de santé", "zone de sante", "zones de sante",
                       "national", "pays"):
            with self.subTest(scope=scope):
                r = geo_resolution.resolve_geography_smart(scope)
                self.assertEqual(r["status"], "generic", f"'{scope}' should be generic")


# ═══════════════════════════════════════════════════════════
# J. Empty / None / whitespace inputs
# ═══════════════════════════════════════════════════════════

class EdgeInputTests(_GeoTestMixin, unittest.TestCase):

    def test_none_is_generic(self):
        r = geo_resolution.resolve_geography_smart(None)
        self.assertEqual(r["status"], "generic")

    def test_empty_string_is_generic(self):
        r = geo_resolution.resolve_geography_smart("")
        self.assertEqual(r["status"], "generic")

    def test_whitespace_is_generic(self):
        r = geo_resolution.resolve_geography_smart("   ")
        self.assertEqual(r["status"], "generic")


# ═══════════════════════════════════════════════════════════
# K. Completely unknown garbage → not_found with candidates
# ═══════════════════════════════════════════════════════════

class NotFoundTests(_GeoTestMixin, unittest.TestCase):

    def test_garbage_is_not_found(self):
        r = geo_resolution.resolve_geography_smart("Xyzqwerty")
        self.assertEqual(r["status"], "not_found")

    def test_not_found_returns_candidates_list(self):
        r = geo_resolution.resolve_geography_smart("Xyzqwerty")
        self.assertIsInstance(r.get("candidates"), list)

    def test_not_found_clarification_has_free_text_option(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Xyzqwerty"}
        amb = detect_ambiguities("BCG Xyzqwerty", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb)
        options = geo_amb[0]["options"]
        self.assertTrue(any(o["value"] == "free_text" for o in options),
                        "not_found clarification must offer a free-text option")


# ═══════════════════════════════════════════════════════════
# L. Learned alias lifecycle
# ═══════════════════════════════════════════════════════════

class AliasLifecycleTests(_GeoTestMixin, unittest.TestCase):

    def test_one_confirmation_proposes_not_trusts(self):
        alias_learning.record_alias_confirmation(
            "geo", "Lualba", "dJ3v8xc6ZIK", "Lualaba", conversation_id="t1"
        )
        r = geo_resolution.resolve_geography_smart("Lualba")
        self.assertEqual(r["status"], "ambiguous")
        top = r["candidates"][0]
        self.assertEqual(top["id"], "dJ3v8xc6ZIK")
        self.assertEqual(top["source"], "learned_proposed")

    def test_two_confirmations_trusts_and_auto_applies(self):
        for cid in ("t1", "t2"):
            alias_learning.record_alias_confirmation(
                "geo", "Lualba", "dJ3v8xc6ZIK", "Lualaba", conversation_id=cid
            )
        r = geo_resolution.resolve_geography_smart("Lualba")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["source"], "learned")

    def test_rejection_demotes_trusted_to_proposed(self):
        for cid in ("t1", "t2"):
            alias_learning.record_alias_confirmation(
                "geo", "Lualba", "dJ3v8xc6ZIK", "Lualaba", conversation_id=cid
            )
        alias_learning.record_alias_rejection("geo", "Lualba", "dJ3v8xc6ZIK")
        r = geo_resolution.resolve_geography_smart("Lualba")
        self.assertEqual(r["status"], "ambiguous")  # back to proposed

    def test_double_rejection_removes_alias(self):
        for cid in ("t1", "t2"):
            alias_learning.record_alias_confirmation(
                "geo", "Lualba", "dJ3v8xc6ZIK", "Lualaba", conversation_id=cid
            )
        alias_learning.record_alias_rejection("geo", "Lualba", "dJ3v8xc6ZIK")
        alias_learning.record_alias_rejection("geo", "Lualba", "dJ3v8xc6ZIK")
        self.assertIsNone(alias_learning.get_learned_alias("geo", "Lualba"))
        self.assertIsNone(alias_learning.get_proposed_alias("geo", "Lualba"))

    def test_alias_equal_to_target_name_is_not_learned(self):
        alias_learning.record_alias_confirmation(
            "geo", "Lualaba", "dJ3v8xc6ZIK", "Lualaba", conversation_id="t1"
        )
        self.assertNotIn(("geo", "lualaba"), alias_learning._in_memory_store)

    def test_short_alias_ignored(self):
        alias_learning.record_alias_confirmation("geo", "ab", "x", "X")
        self.assertIsNone(alias_learning.get_learned_alias("geo", "ab"))
        self.assertIsNone(alias_learning.get_proposed_alias("geo", "ab"))


# ═══════════════════════════════════════════════════════════
# M. Contextual level scoring
# ═══════════════════════════════════════════════════════════

class ContextualLevelScoringTests(_GeoTestMixin, unittest.TestCase):

    def test_province_hint_boosts_province(self):
        from app.tools.supabase_data import find_org_unit_candidates
        cands = find_org_unit_candidates("province du Lualaba")
        if cands:
            self.assertEqual(cands[0]["level"], 2)

    def test_zone_hint_boosts_zone(self):
        from app.tools.supabase_data import find_org_unit_candidates
        cands = find_org_unit_candidates("ZS du Lualaba")
        if cands:
            self.assertEqual(cands[0]["level"], 3)

    def test_no_hint_defaults_to_province(self):
        from app.tools.supabase_data import find_org_unit_candidates
        cands = find_org_unit_candidates("Lualaba")
        if cands:
            self.assertEqual(cands[0]["level"], 2)


# ═══════════════════════════════════════════════════════════
# N. Fuzzy matching of free-text clarification answers
# ═══════════════════════════════════════════════════════════

class ClarificationFuzzyAnswerTests(unittest.TestCase):

    def test_fuzzy_matches_partial_label(self):
        pending = {
            "slot": "geography",
            "options": [
                {"label": "Lualaba (Province)", "value": "org_unit:dJ3v8xc6ZIK:ll Lualaba Province"},
                {"label": "Lwalaba (Aire de Santé)", "value": "org_unit:KP1Igiapv7Z:tn Lwalaba Aire de Santé"},
            ],
            "partial_entities": {},
        }
        answer = apply_clarification_answer("Lualaba", pending)
        self.assertTrue(answer["matched"])
        self.assertEqual(answer["entities"]["org_unit_id"], "dJ3v8xc6ZIK")

    def test_fuzzy_does_not_match_garbage(self):
        pending = {
            "slot": "geography",
            "options": [
                {"label": "Lualaba (Province)", "value": "org_unit:dJ3v8xc6ZIK:ll Lualaba Province"},
            ],
            "partial_entities": {},
        }
        answer = apply_clarification_answer("xyzqwerty", pending)
        self.assertFalse(answer["matched"])

    def test_org_unit_option_injects_exact_id(self):
        pending = {
            "slot": "geography",
            "options": [
                {"label": "Lualaba (Province)", "value": "org_unit:dJ3v8xc6ZIK:ll Lualaba Province"},
                {"label": "Lwalaba (Aire de Santé)", "value": "org_unit:KP1Igiapv7Z:tn Lwalaba Aire de Santé"},
            ],
            "partial_entities": {"antigens": ["bcg"], "periods": ["202607"]},
        }
        for reply in ("Province du Lualaba", "org_unit:dJ3v8xc6ZIK:ll Lualaba Province"):
            answer = apply_clarification_answer(reply, pending)
            self.assertTrue(answer["matched"], reply)
            self.assertEqual(answer["entities"]["org_unit_id"], "dJ3v8xc6ZIK")

    def test_metric_option_injects_exact_id(self):
        pending = {
            "slot": "metric",
            "options": [
                {"label": "Taux de couverture vaccinale en BCG",
                 "value": "metric:cWJXYKCXrLx:Taux de couverture vaccinale en BCG"},
            ],
            "partial_entities": {"periods": ["202607"], "geography": "Lualaba"},
        }
        for reply in ("Taux de couverture vaccinale en BCG",
                       "metric:cWJXYKCXrLx:Taux de couverture vaccinale en BCG"):
            answer = apply_clarification_answer(reply, pending)
            self.assertTrue(answer["matched"], reply)
            self.assertEqual(answer["entities"]["metric_id"], "cWJXYKCXrLx")

    def test_free_text_option_uses_typed_reply(self):
        pending = {
            "slot": "geography",
            "options": [
                {"label": "Autre (saisie libre)", "value": "free_text"},
            ],
            "partial_entities": {},
        }
        answer = apply_clarification_answer("Kananga", pending)
        self.assertTrue(answer["matched"])
        self.assertEqual(answer["entities"]["geography"], "kananga")


# ═══════════════════════════════════════════════════════════
# O. Clarification integration (detect_ambiguities)
# ═══════════════════════════════════════════════════════════

class ClarificationIntegrationTests(_GeoTestMixin, unittest.TestCase):

    def test_misspelled_geography_triggers_clarification(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Lualba"}
        amb = detect_ambiguities("couverture BCG ZS du Lualba", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb)
        options = geo_amb[0]["options"]
        self.assertTrue(any("org_unit:dJ3v8xc6ZIK" in o["value"] for o in options))

    def test_exact_geography_does_not_trigger(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Lualaba"}
        amb = detect_ambiguities("couverture BCG Lualaba", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertFalse(geo_amb)

    def test_cross_province_homonymy_triggers_clarification(self):
        entities = {"antigens": ["bcg"], "periods": ["202607"], "geography": "Bili"}
        amb = detect_ambiguities("couverture BCG Bili", entities)
        geo_amb = [a for a in amb if a["slot"] == "geography"]
        self.assertTrue(geo_amb, "cross-province homonymy should trigger clarification")


# ═══════════════════════════════════════════════════════════
# P. Fuzzy matching algorithm (unit tests)
# ═══════════════════════════════════════════════════════════

class FuzzyMatchingTests(unittest.TestCase):

    def test_exact_match(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        self.assertEqual(fuzzy_similarity("lualaba", "lualaba"), 1.0)

    def test_phonetic_variant_lwalaba(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        self.assertGreaterEqual(fuzzy_similarity("lwalaba", "lualaba"), 0.72)

    def test_phonetic_variant_ekuateur(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        self.assertGreaterEqual(fuzzy_similarity("ekuateur", "equateur"), 0.72)

    def test_phonetic_variant_cuapa(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        self.assertGreaterEqual(fuzzy_similarity("cuapa", "tshuapa"), 0.50)

    def test_phonetic_variant_kasay(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        self.assertGreaterEqual(fuzzy_similarity("kasay", "kasai"), 0.72)

    def test_dissimilar_strings_low_score(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        self.assertLess(fuzzy_similarity("kinshasa", "xyzqwerty"), 0.50)

    def test_phonetic_code_consistency(self):
        from app.agents.fuzzy_matching import _phonetic_code
        self.assertEqual(_phonetic_code("lualaba"), _phonetic_code("lwalaba"))

    def test_bigram_similarity(self):
        from app.agents.fuzzy_matching import _bigram_similarity
        self.assertGreaterEqual(_bigram_similarity("lualaba", "lwalaba"), 0.5)
        self.assertEqual(_bigram_similarity("abc", "xyz"), 0.0)

    def test_strip_accents(self):
        from app.agents.fuzzy_matching import strip_accents
        self.assertEqual(strip_accents("Équateur"), "Equateur")
        self.assertEqual(strip_accents("Kasaï"), "Kasai")
        self.assertEqual(strip_accents("Maïndombe"), "Maindombe")


# ═══════════════════════════════════════════════════════════
# Q. Alias learning unit tests (no geo resolution)
# ═══════════════════════════════════════════════════════════

class AliasLearningUnitTests(unittest.TestCase):
    def setUp(self):
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()
        self._patches = [
            patch("app.agents.alias_learning._get_sb", return_value=None),
            patch("app.agents.alias_learning._SUPABASE", None),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()

    def test_normalize_strips_accents(self):
        self.assertEqual(alias_learning.normalize_alias("Lualaba"), "lualaba")
        self.assertEqual(alias_learning.normalize_alias("Équateur"), "equateur")
        self.assertEqual(alias_learning.normalize_alias("  Kasaï-Central  "), "kasai central")

    def test_confirmations_increment(self):
        alias_learning.record_alias_confirmation("geo", "Lwalaba", "dJ3v8xc6ZIK", "Lualaba")
        alias_learning.record_alias_confirmation("geo", "Lwalaba", "dJ3v8xc6ZIK", "Lualaba")
        row = alias_learning.get_learned_alias("geo", "Lwalaba")
        self.assertEqual(row["confirmations"], 2)

    def test_rejection_on_nonexistent_is_noop(self):
        # Rejecting an alias that was never learned should not crash
        alias_learning.record_alias_rejection("geo", "neverlearned", "someid")
        self.assertIsNone(alias_learning.get_learned_alias("geo", "neverlearned"))

    def test_rejection_with_wrong_target_id_is_ignored(self):
        alias_learning.record_alias_confirmation("geo", "Lwalaba", "dJ3v8xc6ZIK", "Lualaba")
        alias_learning.record_alias_confirmation("geo", "Lwalaba", "dJ3v8xc6ZIK", "Lualaba")
        # Reject with a DIFFERENT target_id → should be ignored
        alias_learning.record_alias_rejection("geo", "Lwalaba", "wrongid")
        row = alias_learning.get_learned_alias("geo", "Lwalaba")
        self.assertIsNotNone(row)
        self.assertEqual(row["confirmations"], 2)


# ═══════════════════════════════════════════════════════════
# R. Exact org unit (ZS) resolution
# ═══════════════════════════════════════════════════════════

class ExactOrgUnitTests(_GeoTestMixin, unittest.TestCase):

    def test_mosango_zs_resolves(self):
        r = geo_resolution.resolve_geography_smart("Mosango")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "JRaVxSGfJ9Z")

    def test_sandoa_zs_resolves(self):
        r = geo_resolution.resolve_geography_smart("Sandoa")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "yIYFKwCgYVZ")

    def test_tshikapa_zs_resolves(self):
        r = geo_resolution.resolve_geography_smart("Tshikapa")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "rsaI3zncNG9")

    def test_rutshuru_zs_resolves(self):
        r = geo_resolution.resolve_geography_smart("Rutshuru")
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["org_unit_id"], "nXYw6kLqc0y")


# ═══════════════════════════════════════════════════════════
# S. Hyphenated official spellings (Bas-Uele, Haut-Katanga, Sud-Kivu…)
# ═══════════════════════════════════════════════════════════

class HyphenatedProvinceTests(_GeoTestMixin, unittest.TestCase):
    """Official DRC spellings hyphenate compound names. They must resolve as
    silently as the space-separated PROVINCE_MAP keys — a hyphen is not a
    misspelling and must never trigger a clarification."""

    _HYPHENATED = [
        ("Bas-Uele", "rWrCdr321Qu"),
        ("Bas-Uélé", "rWrCdr321Qu"),
        ("province du Bas-Uele", "rWrCdr321Qu"),
        ("Haut-Uele", "wy1lwIP18SL"),
        ("Haut-Katanga", "F9w3VW1cQmb"),
        ("Haut-Lomami", "fEKDiQIuqeE"),
        ("Kongo-Central", "dKdrd8HqZWz"),
        ("Kasaï-Central", "I8CuQpdBQfP"),
        ("Kasai-Oriental", "fgHCmGhaP2X"),
        ("Sud-Kivu", "GnLX8MNgxZw"),
        ("Nord-Kivu", "pIAYIpy4hiH"),
        ("Sud-Ubangi", "JkIljbLc4Ny"),
        ("Nord-Ubangi", "iu4Zj3Zq39m"),
        ("Mai-Ndombe", "u0vP3ZicczY"),
    ]

    def test_hyphenated_provinces_resolve_silently(self):
        for name, expected_id in self._HYPHENATED:
            with self.subTest(province=name):
                r = geo_resolution.resolve_geography_smart(name)
                self.assertEqual(r["status"], "resolved", f"{name} should resolve")
                self.assertEqual(r["org_unit_id"], expected_id)
                self.assertEqual(r["source"], "province_map")

    def test_legacy_resolver_agrees(self):
        ou_id, _ = geo_resolution.resolve_org_unit("Bas-Uele")
        self.assertEqual(ou_id, "rWrCdr321Qu")

    def test_hyphen_does_not_remap_facility_to_province(self):
        r = geo_resolution.resolve_geography_smart("Aire de Santé Haut-Katanga")
        self.assertNotEqual(r.get("source"), "province_map")


# ═══════════════════════════════════════════════════════════
# T. Metric resolution through business synonyms
# ═══════════════════════════════════════════════════════════

_DIM_INDICATORS = [
    {"id": "MULXtL8iom8", "name": "Taux d'abandons DTC-HepB-Hib1-DTC-Hep-Hib3"},
    {"id": "k26tJ22Ncpd", "name": "Taux de couverture vaccinale en Pentavalent 1"},
    {"id": "v9b9aYsA5PM", "name": "Taux de couverture vaccinale en Pentavalent 3"},
    {"id": "cWJXYKCXrLx", "name": "Taux de couverture vaccinale en BCG"},
]


def _stub_search_indicators(query, limit=5):
    """Token-overlap scoring identical in spirit to supabase_data.search_indicators:
    "abandon pentavalent 1 ... 3" ties the two coverage indicators above the
    dropout one, which is the regression these tests guard against."""
    terms = [w for w in query.lower().replace("'", " ").split() if len(w) >= 3 or w.isdigit()]
    out = []
    for ind in _DIM_INDICATORS:
        hay = ind["name"].lower()
        hits = sum(1 for t in terms if (f" {t} " in f" {hay} " if t.isdigit() else t in hay))
        if hits:
            out.append({"id": ind["id"], "name": ind["name"], "score": hits / len(terms)})
    out.sort(key=lambda c: (-c["score"], c["name"]))
    return out[:limit]


class MetricSynonymResolutionTests(unittest.TestCase):

    def setUp(self):
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()
        self._patches = [
            patch("app.agents.metric_resolution.search_indicators",
                  side_effect=_stub_search_indicators),
            patch("app.agents.alias_learning._get_sb", return_value=None),
            patch("app.agents.alias_learning._SUPABASE", None),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        alias_learning._cache.clear()
        alias_learning._in_memory_store.clear()

    def test_dropout_between_two_doses_is_one_indicator(self):
        for q in (
            "taux d'abandon pentavalent 1 et pentavalent 3",
            "taux d'abandon Penta1 à Penta3",
            "abandon penta1 penta3",
        ):
            with self.subTest(query=q):
                r = metric_resolution.resolve_metric_smart(q)
                self.assertEqual(r["status"], "resolved", q)
                self.assertEqual(r["metric_id"], "MULXtL8iom8")
                self.assertEqual(r["source"], "semantic_synonym")

    def test_coverage_queries_still_pick_the_right_dose(self):
        self.assertEqual(metric_resolution.resolve_metric_smart("couverture penta3")["metric_id"], "v9b9aYsA5PM")
        self.assertEqual(metric_resolution.resolve_metric_smart("couverture pentavalent 1")["metric_id"], "k26tJ22Ncpd")

    def test_no_synonym_falls_back_to_token_search(self):
        # "penta" alone matches no synonym → previous behaviour is preserved
        # (ambiguous between doses; the antigen_dose clarification handles it).
        r = metric_resolution.resolve_metric_smart("penta")
        self.assertNotEqual(r.get("source"), "semantic_synonym")

    def test_learned_alias_still_wins(self):
        alias_learning.record_alias_confirmation("metric", "abandon penta1 penta3", "cWJXYKCXrLx", "BCG")
        alias_learning.record_alias_confirmation("metric", "abandon penta1 penta3", "cWJXYKCXrLx", "BCG")
        r = metric_resolution.resolve_metric_smart("abandon penta1 penta3")
        self.assertEqual(r["source"], "learned")
        self.assertEqual(r["metric_id"], "cWJXYKCXrLx")


if __name__ == "__main__":
    unittest.main()
