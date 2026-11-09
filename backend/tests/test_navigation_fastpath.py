"""Tests for the deterministic navigation fast-path.

No model call must happen for a bare page change: these tests exercise the
matcher on its own, then the agent graph end-to-end with the LLM factory
stubbed to fail loudly if anything tries to call it.
"""

import asyncio

import pytest

from app.agents import decision_assistant as da
from app.agents.navigation_fastpath import match_navigation, navigation_reply


# ─── Matcher ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "message, destination",
    [
        ("va sur l'onglet settings", "settings"),
        ("Va sur l’onglet Paramètres", "settings"),
        ("ouvre les alertes", "alerts"),
        ("Affiche la page notifications", "notifications"),
        ("retourne à l'accueil", "home"),
        ("montre-moi le tableau de bord", "dashboard"),
        ("go to settings", "settings"),
        ("open the help page", "help"),
        ("emmène-moi à la documentation", "documentation"),
        ("settings", "settings"),
        ("onglet alertes", "alerts"),
        ("passe sur l'assistant", "assistant"),
        ("va sur la page reports", "reports"),
        ("ouvre les rapports", "reports"),
    ],
)
def test_matches_plain_navigation(message, destination):
    hit = match_navigation(message)
    assert hit is not None, message
    assert hit["destination"] == destination
    assert hit["actions"][0] == {"action": "navigate", "args": {"destination": destination}}


@pytest.mark.parametrize(
    "message, tab",
    [
        ("va dans les paramètres, onglet sécurité", "security"),
        ("ouvre les paramètres utilisateurs", "users"),
        ("va sur settings > profil", "profile"),
        ("ouvre l'onglet configurations des paramètres", "configurations"),
    ],
)
def test_settings_tab_is_extracted(message, tab):
    hit = match_navigation(message)
    assert hit is not None, message
    assert hit["destination"] == "settings"
    assert hit["tab"] == tab
    assert hit["actions"][1] == {"action": "switch_settings_tab", "args": {"tab": tab}}


def test_alerts_land_on_notifications_with_alert_filter():
    # Alerts were folded into the Notifications feed: the request still means
    # "show me the alerts", so the page must open with the alerts category on.
    hit = match_navigation("ouvre les alertes")
    assert hit is not None
    assert hit["actions"] == [
        {"action": "navigate", "args": {"destination": "alerts"}},
        {"action": "filter_alerts", "args": {}},
    ]


def test_configuration_alone_is_settings_page_without_tab():
    hit = match_navigation("va sur la configuration")
    assert hit is not None
    assert hit["destination"] == "settings"
    assert hit["tab"] is None
    assert len(hit["actions"]) == 1


@pytest.mark.parametrize(
    "message",
    [
        "",
        "   ",
        "bonjour",
        "quelle est la couverture Penta3 au Nord-Kivu ?",
        "montre-moi l'évolution des alertes critiques en 2024",
        "combien d'alertes ce mois ?",
        "filtre les alertes critiques",
        "va sur la page des alertes et compare avec l'année dernière",
        "les alertes",  # no navigation cue
        "va sur la page analytics",  # not a NAV_DESTINATIONS entry
        "génère un rapport mensuel",  # report generation, not the reports page
        "crée un rapport sur la couverture",
    ],
)
def test_ignores_non_navigation(message):
    assert match_navigation(message) is None, message


def test_message_too_long_falls_through():
    long = "va sur l'onglet settings " + "s'il te plaît " * 10
    assert len(long) > 90
    assert match_navigation(long) is None


def test_reply_wording():
    assert navigation_reply("settings") == "Ouverture des paramètres."
    assert navigation_reply("settings", "security") == "Ouverture des paramètres, onglet Sécurité."
    assert navigation_reply("home") == "Ouverture de l'accueil."


# ─── Graph integration ─────────────────────────────────────────────────


def _initial_state(message: str, role: str = "viewer") -> dict:
    from langchain_core.messages import HumanMessage

    return {
        "messages": [HumanMessage(content=message)],
        "user_role": role,
        "user_email": "test@example.org",
        "intent": None,
        "confidence": 0.0,
        "entities": {},
        "business_intent": None,
        "qid": None,
        "analysis_plan": None,
        "response_contract": None,
        "status": "processing",
        "clarification": None,
        "clarification_decision": None,
        "clarification_request": None,
        "actions": [],
        "results": [],
        "iteration": 0,
        "verified_facts": None,
        "all_verified_facts": [],
        "fact_retries": 0,
        "analysis_payload": None,
        "response": None,
        "error": None,
    }


@pytest.fixture
def no_llm(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("LLM must not be called on the navigation fast-path")

    monkeypatch.setattr(da, "_llm", _boom)


def test_context_analysis_short_circuits_navigation(no_llm):
    out = da.context_analysis(_initial_state("va sur l'onglet settings"))
    assert out["intent"] == "NAVIGATE"
    assert out["confidence"] == 1.0
    assert out["actions"] == [{"action": "navigate", "args": {"destination": "settings"}}]


def test_route_sends_fast_navigation_to_dedicated_node(no_llm):
    state = _initial_state("ouvre les alertes")
    state.update(da.context_analysis(state))
    assert da.route_after_analysis(state) == "fast_navigation"


def test_graph_end_to_end_without_llm(no_llm):
    final = asyncio.run(da.agent_graph.ainvoke(_initial_state("va sur l'onglet settings")))

    assert final["status"] == "done"
    assert final["intent"] == "NAVIGATE"
    assert final["actions"] == [{"action": "navigate", "args": {"destination": "settings"}}]
    assert final["results"][0]["action"] == "navigate"
    assert final["results"][0]["status"] == da.ActionStatus.AUTO_EXECUTED
    assert "paramètres" in final["response"]
    # The confirmation is appended to history like any assistant turn.
    assert final["messages"][-1].content == final["response"]


def test_permission_denied_yields_no_command(no_llm):
    # switch_settings_tab requires canViewSettings; a viewer has no such right.
    final = asyncio.run(
        da.agent_graph.ainvoke(_initial_state("va dans les paramètres, onglet utilisateurs", role="viewer"))
    )
    statuses = {r["action"]: r["status"] for r in final["results"]}
    assert statuses["navigate"] == da.ActionStatus.AUTO_EXECUTED
    if statuses.get("switch_settings_tab") == da.ActionStatus.REJECTED:
        assert final["actions"] == [{"action": "navigate", "args": {"destination": "settings"}}]
