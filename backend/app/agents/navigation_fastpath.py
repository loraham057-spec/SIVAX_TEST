"""Deterministic fast-path for plain navigation requests.

"Va sur l'onglet settings", "ouvre les alertes", "go to notifications" — these
carry no health-data question and need no model call. Previously they went
through context_analysis (LLM) then planner (LLM, tool-calling) before the
frontend finally received a `navigate` command. Two model round-trips for a
page change, and one more code path where a regression in the analysis
prompt could break a page change (the PROVINCE_MAP NameError incident).

This module recognises such requests with a regex and emits the exact
commands the planner would have produced, so the existing frontend executor
needs no change. It is conservative on purpose: any hint of an analytical
question falls through to the normal pipeline.
"""

from __future__ import annotations

import re
import unicodedata

from app.tools.schema import NAV_DESTINATIONS, SETTINGS_TABS

# Requests longer than this are unlikely to be a bare page change.
MAX_MESSAGE_CHARS = 90

# Destination keyword (accent-stripped, lower-case) → NAV_DESTINATIONS key.
# Order matters where one alias is a prefix of another ("notification" before
# "notif" is not needed because regex alternation is tried left-to-right on
# the longest literal first — see _alternation()).
_DESTINATION_ALIASES: dict[str, str] = {
    "tableau de bord": "dashboard",
    "dashboard": "dashboard",
    "accueil": "home",
    "home": "home",
    "page principale": "home",
    "assistant": "assistant",
    "agent ia": "assistant",
    "alertes": "alerts",
    "alerte": "alerts",
    "alerts": "alerts",
    "notifications": "notifications",
    "notification": "notifications",
    "notifs": "notifications",
    "rapports": "reports",
    "rapport": "reports",
    "reports": "reports",
    "report": "reports",
    "parametres": "settings",
    "reglages": "settings",
    "settings": "settings",
    "configurations": "settings",
    "configuration": "settings",
    "aide": "help",
    "help": "help",
    "support": "help",
    "documentation": "documentation",
    "docs": "documentation",
    "doc": "documentation",
}

# Settings tab keyword → SETTINGS_TABS entry.
_TAB_ALIASES: dict[str, str] = {
    "profil": "profile",
    "profile": "profile",
    "configurations": "configurations",
    "configuration": "configurations",
    "securite": "security",
    "security": "security",
    "utilisateurs": "users",
    "users": "users",
}

_NAV_VERBS = (
    r"\b(?:va|vas|aller|allez|allons|allé|rends[- ]toi|rendez[- ]vous|navigue[rz]?|"
    r"ouvre[rz]?|ouvrir|affiche[rz]?|afficher|montre[rz]?|montrer|"
    r"emmene[- ]moi|amene[- ]moi|conduis[- ]moi|redirige[- ]moi|retourne[rz]?|retour|"
    r"acced(?:e|er|ez)|bascule[rz]?|passe[rz]?|"
    r"go|open|navigate|take me|bring me|show(?: me)?|switch|head)\b"
)
_PAGE_WORDS = r"\b(?:page|onglet|ecran|section|menu|tab|screen|vue)\b"

# Anything analytical or data-related → not a bare navigation. Stems are
# matched on their prefix only ("compar" catches "compare", "comparaison").
_ANALYSIS_TERMS = re.compile(
    r"\b(?:analys|evolution|tendance|couverture|taux|combien|nombre|cas\b|doses?\b|"
    r"vaccin|penta|bcg|rougeole|paludisme|province|zone|aire\b|fosa|compar|"
    r"pourquoi|comment|quel|prevision|forecast|gener|cree|creer|produi|redige|export|"
    r"filtr|critique|severite|graphique|courbe|carte|tableau des|"
    r"annee|mois\b|semaine|periode|dernier|\d{4}\b)",
    re.IGNORECASE,
)


def _strip_accents(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _normalize(text: str) -> str:
    text = _strip_accents(text.lower())
    text = re.sub(r"[’']", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _alternation(keys: list[str]) -> str:
    # Longest literal first so "notifications" wins over "notification".
    return "|".join(re.escape(k) for k in sorted(keys, key=len, reverse=True))


_DEST_RE = re.compile(r"\b(" + _alternation(list(_DESTINATION_ALIASES)) + r")\b")
_TAB_RE = re.compile(r"\b(" + _alternation(list(_TAB_ALIASES)) + r")\b")
_VERB_RE = re.compile(_NAV_VERBS)
_PAGE_RE = re.compile(_PAGE_WORDS)


def match_navigation(message: str) -> dict | None:
    """Return the navigation commands for a bare page-change request.

    Returns None when the message is not a plain navigation request, so the
    caller falls through to the LLM pipeline. On a hit:

        {
            "destination": "settings",
            "tab": "security" | None,
            "actions": [{"action": "navigate", "args": {"destination": "settings"}},
                        {"action": "switch_settings_tab", "args": {"tab": "security"}}],
        }
    """
    raw = message.strip()
    if not raw or len(raw) > MAX_MESSAGE_CHARS:
        return None

    text = _normalize(raw)
    if _ANALYSIS_TERMS.search(text):
        return None

    # "configuration(s)" doubles as a settings tab name; when the message also
    # names the page itself ("onglet configurations des paramètres"), let the
    # unambiguous word select the destination and leave the other for the tab.
    dest_matches = list(_DEST_RE.finditer(text))
    if not dest_matches:
        return None
    dest_match = next(
        (m for m in dest_matches if not m.group(1).startswith("configuration")),
        dest_matches[0],
    )

    # Need an explicit navigation cue: a verb, or a page/tab word, or the
    # message being nothing but the destination itself ("settings").
    bare_destination = text == dest_match.group(1)
    if not (bare_destination or _VERB_RE.search(text) or _PAGE_RE.search(text)):
        return None

    destination = _DESTINATION_ALIASES[dest_match.group(1)]
    if destination not in NAV_DESTINATIONS:
        return None

    actions: list[dict] = [{"action": "navigate", "args": {"destination": destination}}]

    # Alerts live in the Notifications feed; land on it with the alerts
    # category pre-selected so the request still means "show me the alerts".
    if destination == "alerts":
        actions.append({"action": "filter_alerts", "args": {}})

    tab: str | None = None
    if destination == "settings":
        tab_match = _TAB_RE.search(text)
        if tab_match:
            candidate = _TAB_ALIASES[tab_match.group(1)]
            # "configuration" alone means the settings page, not necessarily
            # the tab — only emit the tab switch when the word is not the
            # same token that selected the destination.
            if candidate in SETTINGS_TABS and (
                candidate != "configurations" or tab_match.start() != dest_match.start()
            ):
                tab = candidate
                actions.append({"action": "switch_settings_tab", "args": {"tab": tab}})

    return {"destination": destination, "tab": tab, "actions": actions}


# Labels already carry the contracted preposition ("de l'", "du", "des").
_DESTINATION_LABELS_FR: dict[str, str] = {
    "home": "de l'accueil",
    "dashboard": "du tableau de bord",
    "assistant": "de l'assistant",
    "alerts": "des alertes",
    "notifications": "des notifications",
    "reports": "des rapports",
    "settings": "des paramètres",
    "help": "de l'aide",
    "documentation": "de la documentation",
}

_TAB_LABELS_FR: dict[str, str] = {
    "profile": "Profil",
    "configurations": "Configurations",
    "security": "Sécurité",
    "users": "Utilisateurs",
}


def navigation_reply(destination: str, tab: str | None = None) -> str:
    """Short French confirmation shown in the chat once the page changes."""
    label = _DESTINATION_LABELS_FR.get(destination, f"de {destination}")
    if tab:
        return f"Ouverture {label}, onglet {_TAB_LABELS_FR.get(tab, tab)}."
    return f"Ouverture {label}."
