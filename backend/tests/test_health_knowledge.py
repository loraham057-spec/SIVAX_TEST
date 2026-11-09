"""Tests for the health domain knowledge extracted from doc_sante.

Covers HEALTH_TERMINOLOGY, CAMPAIGN_TYPES, CALCULATION_FORMULAS,
OPERATIONAL_THRESHOLDS, SPECIAL_POPULATIONS, ADMINISTRATIVE_STRUCTURE,
and the new SemanticLayer methods that expose them.
"""

import unittest

from app.tools.semantic_layer import (
    ADMINISTRATIVE_STRUCTURE,
    CALCULATION_FORMULAS,
    CAMPAIGN_TYPES,
    HEALTH_TERMINOLOGY,
    OPERATIONAL_THRESHOLDS,
    SPECIAL_POPULATIONS,
    SemanticLayer,
)


class TestHealthTerminology(unittest.TestCase):
    """Test the HEALTH_TERMINOLOGY dictionary and resolve_terminology()."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_terminology_has_vaccine_entries(self):
        """Key vaccine abbreviations are present."""
        for key in ("vpob", "nvpo2", "vpom2", "vpot", "vpi", "bcg", "penta", "mr", "var", "vat", "pcv13"):
            self.assertIn(key, HEALTH_TERMINOLOGY, f"Missing vaccine: {key}")
            self.assertEqual(HEALTH_TERMINOLOGY[key]["category"], "vaccine")

    def test_terminology_has_epidemiology_entries(self):
        """Epidemiological terms are present."""
        for key in ("cvdpv", "pfa", "wpv", "mev"):
            self.assertIn(key, HEALTH_TERMINOLOGY)
            self.assertEqual(HEALTH_TERMINOLOGY[key]["category"], "epidemiology")

    def test_terminology_has_program_entries(self):
        """Program and institutional abbreviations are present."""
        for key in ("pev", "coup", "cpc", "clc", "imep"):
            self.assertIn(key, HEALTH_TERMINOLOGY)
            self.assertEqual(HEALTH_TERMINOLOGY[key]["category"], "program")

    def test_terminology_has_campaign_entries(self):
        """Campaign type abbreviations are present."""
        for key in ("avs", "jnv", "jlv"):
            self.assertIn(key, HEALTH_TERMINOLOGY)
            self.assertEqual(HEALTH_TERMINOLOGY[key]["category"], "campaign")

    def test_terminology_has_monitoring_entries(self):
        """Monitoring and evaluation terms are present."""
        for key in ("lqas", "pcv_vvm", "pfmd", "mapi", "odk"):
            self.assertIn(key, HEALTH_TERMINOLOGY)

    def test_terminology_has_geography_entries(self):
        """Administrative geography abbreviations are present."""
        for key in ("zs", "as", "bczs", "cs", "dps", "antenne"):
            self.assertIn(key, HEALTH_TERMINOLOGY)
            self.assertEqual(HEALTH_TERMINOLOGY[key]["category"], "geography")

    def test_terminology_has_population_entries(self):
        """Population category terms are present."""
        for key in ("ecm", "zero_dose", "sous_vaccine"):
            self.assertIn(key, HEALTH_TERMINOLOGY)
            self.assertEqual(HEALTH_TERMINOLOGY[key]["category"], "population")

    def test_vpob_has_pfmd_true(self):
        """VPOb supports multi-dose vial policy."""
        self.assertTrue(HEALTH_TERMINOLOGY["vpob"]["pfmd"])

    def test_nvpo2_has_pfmd_false(self):
        """nVPO2 does NOT support multi-dose vial policy."""
        self.assertFalse(HEALTH_TERMINOLOGY["nvpo2"]["pfmd"])

    def test_resolve_terminology_finds_vpob(self):
        """resolve_terminology detects VPOb in a query."""
        r = self.sl.resolve_terminology("Quelle est la couverture VPOb au Lualaba ?")
        self.assertEqual(r["status"], "ready")
        keys = [m["key"] for m in r["matches"]]
        self.assertIn("vpob", keys)

    def test_resolve_terminology_finds_multiple_terms(self):
        """resolve_terminology detects multiple abbreviations."""
        r = self.sl.resolve_terminology("LQAS pour les JNV avec VPOb dans les ZS")
        self.assertEqual(r["status"], "ready")
        keys = [m["key"] for m in r["matches"]]
        self.assertIn("lqas", keys)
        self.assertIn("jnv", keys)
        self.assertIn("vpob", keys)
        self.assertIn("zs", keys)

    def test_resolve_terminology_no_match(self):
        """resolve_terminology returns no_match for plain text."""
        r = self.sl.resolve_terminology("Bonjour, comment ça va ?")
        self.assertEqual(r["status"], "no_match")
        self.assertEqual(r["matches"], [])

    def test_resolve_terminology_expanded_terms(self):
        """expanded_terms maps abbreviation to full name."""
        r = self.sl.resolve_terminology("PFA détecté dans la ZS")
        self.assertEqual(r["status"], "ready")
        self.assertIn("pfa", r["expanded_terms"])
        self.assertIn("Paralysie", r["expanded_terms"]["pfa"])


class TestCampaignTypes(unittest.TestCase):
    """Test CAMPAIGN_TYPES and get_campaign_info()."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_jnv_exists(self):
        self.assertIn("jnv", CAMPAIGN_TYPES)
        self.assertEqual(CAMPAIGN_TYPES["jnv"]["target_age"], "0-59 mois")

    def test_riposte_cvdpv1_uses_vpob(self):
        self.assertIn("riposte_cvdpv1", CAMPAIGN_TYPES)
        self.assertIn("VPOb", CAMPAIGN_TYPES["riposte_cvdpv1"]["vaccine"])

    def test_riposte_cvdpv2_uses_nvpo2(self):
        self.assertIn("riposte_cvdpv2", CAMPAIGN_TYPES)
        self.assertIn("nVPO2", CAMPAIGN_TYPES["riposte_cvdpv2"]["vaccine"])

    def test_get_campaign_info_by_key(self):
        r = self.sl.get_campaign_info("jnv")
        self.assertEqual(r["status"], "ready")
        self.assertEqual(r["short_name"], "JNV")

    def test_get_campaign_info_by_short_name(self):
        r = self.sl.get_campaign_info("JNV")
        self.assertEqual(r["status"], "ready")

    def test_get_campaign_info_not_found(self):
        r = self.sl.get_campaign_info("xyz")
        self.assertEqual(r["status"], "not_found")

    def test_all_campaigns_have_duration(self):
        for key, ct in CAMPAIGN_TYPES.items():
            self.assertIn("duration", ct, f"Missing duration in {key}")


class TestCalculationFormulas(unittest.TestCase):
    """Test CALCULATION_FORMULAS and get_formula()."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_taux_perte_formula(self):
        r = self.sl.get_formula("taux_perte")
        self.assertEqual(r["status"], "ready")
        self.assertIn("Doses utilisées", r["formula"])

    def test_facteur_perte_has_vaccine_values(self):
        r = self.sl.get_formula("facteur_perte")
        self.assertEqual(r["status"], "ready")
        values = r["values_by_vaccine"]
        self.assertAlmostEqual(values["VPOb"], 1.18)
        self.assertAlmostEqual(values["nVPO2"], 1.25)
        self.assertAlmostEqual(values["VAR"], 1.10)

    def test_cible_vpo_formula(self):
        r = self.sl.get_formula("cible_vpo")
        self.assertEqual(r["status"], "ready")
        self.assertIn("18,9%", r["formula"])

    def test_taux_abandon_formula(self):
        r = self.sl.get_formula("taux_abandon")
        self.assertEqual(r["status"], "ready")
        self.assertIn("Dose1", r["formula"])

    def test_get_formula_not_found(self):
        r = self.sl.get_formula("nonexistent")
        self.assertEqual(r["status"], "not_found")

    def test_besoin_flacons_has_examples(self):
        r = self.sl.get_formula("besoin_flacons")
        self.assertEqual(r["status"], "ready")
        self.assertIn("examples", r)
        self.assertIn("urbain_vpoB", r["examples"])


class TestOperationalThresholds(unittest.TestCase):
    """Test OPERATIONAL_THRESHOLDS and get_operational_threshold()."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_lqas_80_threshold(self):
        r = self.sl.get_operational_threshold("lqas_80")
        self.assertEqual(r["status"], "ready")
        self.assertIn("9 enfants", r["pass_condition"])

    def test_lqas_90_threshold(self):
        r = self.sl.get_operational_threshold("lqas_90")
        self.assertEqual(r["status"], "ready")
        self.assertIn("borderline", r)

    def test_revaccination_threshold(self):
        r = self.sl.get_operational_threshold("revaccination_10pct")
        self.assertEqual(r["status"], "ready")
        self.assertIn("10%", r["threshold"])

    def test_ecm_criteria_has_4_criteria(self):
        r = self.sl.get_operational_threshold("ecm_criteres")
        self.assertEqual(r["status"], "ready")
        self.assertEqual(len(r["criteria"]), 4)

    def test_perte_vaccins_thresholds(self):
        r = self.sl.get_operational_threshold("perte_vaccins_administration")
        self.assertEqual(r["status"], "ready")
        self.assertIn("20%", r["critical"])

    def test_get_operational_threshold_not_found(self):
        r = self.sl.get_operational_threshold("nonexistent")
        self.assertEqual(r["status"], "not_found")


class TestSpecialPopulations(unittest.TestCase):
    """Test SPECIAL_POPULATIONS and get_special_populations()."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_nomades_in_bas_uele(self):
        r = self.sl.get_special_populations("Bas Uélé")
        self.assertEqual(r["status"], "ready")
        keys = [p["key"] for p in r["populations"]]
        self.assertIn("nomades", keys)

    def test_miniers_in_lualaba(self):
        r = self.sl.get_special_populations("Lualaba")
        self.assertEqual(r["status"], "ready")
        keys = [p["key"] for p in r["populations"]]
        self.assertIn("miniers", keys)

    def test_pecheurs_in_lualaba(self):
        r = self.sl.get_special_populations("Lualaba")
        keys = [p["key"] for p in r["populations"]]
        self.assertIn("pecheurs", keys)

    def test_marches_in_all_provinces(self):
        r = self.sl.get_special_populations("Kinshasa")
        keys = [p["key"] for p in r["populations"]]
        self.assertIn("marches", keys)

    def test_all_populations_returned_without_province(self):
        r = self.sl.get_special_populations()
        self.assertEqual(r["status"], "ready")
        self.assertEqual(len(r["populations"]), len(SPECIAL_POPULATIONS))


class TestAdministrativeStructure(unittest.TestCase):
    """Test ADMINISTRATIVE_STRUCTURE."""

    def test_has_all_levels(self):
        for level in ("national", "province", "antenne", "zone_sante", "aire_sante", "centre_sante"):
            self.assertIn(level, ADMINISTRATIVE_STRUCTURE)

    def test_antenne_is_intermediate(self):
        self.assertIn("antenne", ADMINISTRATIVE_STRUCTURE)
        self.assertIn("MCA", ADMINISTRATIVE_STRUCTURE["antenne"]["entities"])

    def test_zone_sante_has_519(self):
        self.assertIn("519", ADMINISTRATIVE_STRUCTURE["zone_sante"]["name"])


class TestGetHealthContext(unittest.TestCase):
    """Test get_health_context() — the combined context method."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_context_with_vpob_query(self):
        r = self.sl.get_health_context("Couverture VPOb au Lualaba")
        self.assertEqual(r["status"], "ready")
        self.assertIn("terminology", r)

    def test_context_with_jnv_query(self):
        r = self.sl.get_health_context("Résultats LQAS des JNV de mars")
        self.assertEqual(r["status"], "ready")
        self.assertIn("campaign_type", r)
        self.assertIn("lqas_80", r)

    def test_context_with_perte_query(self):
        r = self.sl.get_health_context("Quel est le taux de perte des vaccins ?")
        self.assertEqual(r["status"], "ready")
        self.assertIn("formulas", r)

    def test_context_with_ecm_query(self):
        r = self.sl.get_health_context("Quels sont les critères ECM ?")
        self.assertEqual(r["status"], "ready")
        self.assertIn("ecm_criteria", r)

    def test_context_with_zero_dose_query(self):
        r = self.sl.get_health_context("Combien d'enfants zéro dose ?")
        self.assertEqual(r["status"], "ready")
        self.assertIn("zero_dose", r)

    def test_context_plain_text_no_domain(self):
        r = self.sl.get_health_context("Bonjour, comment ça va ?")
        self.assertEqual(r["status"], "ready")
        self.assertNotIn("terminology", r)
        self.assertNotIn("formulas", r)


class TestVaccineInfo(unittest.TestCase):
    """Test get_vaccine_info()."""

    def setUp(self):
        self.sl = SemanticLayer()

    def test_vpob_info(self):
        r = self.sl.get_vaccine_info("VPOb")
        self.assertEqual(r["status"], "ready")
        self.assertTrue(r["pfmd"])
        self.assertIn("2 gouttes", r["administration"])

    def test_nvpo2_info(self):
        r = self.sl.get_vaccine_info("nVPO2")
        self.assertEqual(r["status"], "ready")
        self.assertFalse(r["pfmd"])

    def test_bcg_info(self):
        r = self.sl.get_vaccine_info("BCG")
        self.assertEqual(r["status"], "ready")
        self.assertEqual(r["category"], "vaccine")

    def test_not_found(self):
        r = self.sl.get_vaccine_info("xyz")
        self.assertEqual(r["status"], "not_found")


class TestSuggestFollowupsListDepth(unittest.TestCase):
    """Regression test for the 'unhashable type: list' bug.

    The LLM sometimes returns analysis_depth as a list (e.g. ["diagnosis"])
    instead of a string. suggest_followups used _DEPTH_FOLLOWUPS.get(depth)
    which crashes with TypeError: unhashable type: 'list' because dict keys
    must be hashable.
    """

    def test_depth_as_list_does_not_crash(self):
        from app.agents.clarification_engine import suggest_followups
        entities = {"analysis_depth": ["diagnosis"]}
        result = suggest_followups(None, entities, "diagnosis")
        self.assertIsInstance(result, list)

    def test_depth_as_empty_list_falls_back(self):
        from app.agents.clarification_engine import suggest_followups
        entities = {"analysis_depth": []}
        result = suggest_followups(None, entities, "diagnosis")
        self.assertIsInstance(result, list)
        self.assertTrue(len(result) >= 1)

    def test_depth_as_string_works(self):
        from app.agents.clarification_engine import suggest_followups
        entities = {"analysis_depth": "diagnosis"}
        result = suggest_followups(None, entities, "diagnosis")
        self.assertIsInstance(result, list)

    def test_depth_as_int_falls_back(self):
        from app.agents.clarification_engine import suggest_followups
        entities = {"analysis_depth": 42}
        result = suggest_followups(None, entities, "diagnosis")
        self.assertIsInstance(result, list)


class TestAnalyticalFollowupDetection(unittest.TestCase):
    """Regression: analytical follow-ups like "quelles sont les zones les
    plus a risque ?" must be detected as follow-ups so they inherit the
    previous analysis context (indicator, geography, period) instead of
    being treated as standalone CHAT and getting a generic answer.
    """

    def test_quelles_sont_les_zones_a_risque(self):
        from app.agents.conversation_context import is_followup
        self.assertTrue(is_followup("quelles sont les zones les plus a risque ?"))

    def test_quelles_sont_les_zones_fortes(self):
        from app.agents.conversation_context import is_followup
        self.assertTrue(is_followup("quelles sont les zones les plus faibles ?"))

    def test_pourquoi_certaines_zones(self):
        from app.agents.conversation_context import is_followup
        self.assertTrue(is_followup("pourquoi certaines zones sont sous le seuil ?"))

    def test_classement_des_zones(self):
        from app.agents.conversation_context import is_followup
        self.assertTrue(is_followup("classement des zones"))

    def test_trivial_chat_not_followup(self):
        from app.agents.conversation_context import is_followup
        self.assertFalse(is_followup("bonjour"))
        self.assertFalse(is_followup("merci beaucoup"))


if __name__ == "__main__":
    unittest.main()
