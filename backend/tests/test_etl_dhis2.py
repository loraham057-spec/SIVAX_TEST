"""Pure-logic tests for the DHIS2 ETL extractor."""

from datetime import datetime
from unittest.mock import patch

from app.etl.sources import dhis2


class _FixedDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return cls(2026, 10, 3)


def test_scope_periods_skip_months_still_reported():
    with patch.object(dhis2, "datetime", _FixedDatetime):
        assert dhis2.scope_periods("incremental") == ["202608", "202607", "202606"]
        assert dhis2.scope_periods("weekly") == ["202608", "202607", "202606"]
        assert dhis2.scope_periods("full") == dhis2.scope_periods("weekly")  # legacy alias
        assert dhis2.scope_periods("history") == ["202605", "202604", "202603", "202602", "202601", "202512"]


def test_history_windows_walk_back_without_overlap(monkeypatch):
    with patch.object(dhis2, "datetime", _FixedDatetime):
        monkeypatch.setenv("ETL_MONTHS", "6")
        monkeypatch.setenv("ETL_MONTHS_OFFSET", "9")
        assert dhis2.scope_periods("history") == ["202511", "202510", "202509", "202508", "202507", "202506"]


def test_co_rows_become_operands_and_unwanted_combos_are_dropped():
    analytics = {"rows": [
        ["l1bhrYUPsde", "kOWsLrtvrhn", "202608", "ROOT", "828650"],
        ["l1bhrYUPsde", "ddJmZUacsvQ", "202608", "ROOT", "1417463"],  # Qté à commander: not kept
        ["l1bhrYUPsde", "t5L9ODSuYOG", "202608", "ROOT", "n/a"],
    ]}
    rows = dhis2._rows_from_co_analytics(analytics, set(dhis2.SIGL_COCS))
    assert rows == [{"indicator_id": "l1bhrYUPsde.kOWsLrtvrhn", "period": "202608", "value": 828650.0, "org_unit": "ROOT"}]


def test_sigl_operands_cover_the_wastage_rate_formula():
    # (utilisée − administrée) ÷ utilisée, per antigen (wastage page).
    ids = {d["id"] for d in dhis2.SIGL_OPERANDS}
    for de in dhis2.SIGL_VACCINES:
        assert {f"{de}.pdKyvaYRqCj", f"{de}.dxDQKDcTn6Z"} <= ids


def test_count_stockouts_counts_each_facility_once_per_level():
    so = dhis2.STOCKOUT_COC
    analytics = {
        "metaData": {"ouHierarchy": {"F1": "R/P1/Z1/A1", "F2": "R/P1/Z2/A2", "F3": "R/P2/Z3/A3"}},
        "rows": [
            [f"l1bhrYUPsde.{so}", "202608", "F1", "3"],
            [f"uAWIVDnGPGH.{so}", "202608", "F1", "2"],
            [f"l1bhrYUPsde.{so}", "202608", "F2", "0"],  # no stock-out
            [f"uAWIVDnGPGH.{so}", "202608", "F2", "5"],
        ],
    }
    p2 = {"metaData": {"ouHierarchy": {"F3": "R/P2/Z3/A3"}}, "rows": [[f"uAWIVDnGPGH.{so}", "202608", "F3", "1"]]}
    zones = {"P1": ["Z1", "Z2"], "P2": ["Z3"]}
    got = {
        (r["indicator_id"], r["period"], r["org_unit"]): r["value"]
        for r in dhis2.count_stockouts([("P1", "202608", analytics), ("P2", "202608", p2)], "R", zones, ["P1", "P2"])
    }
    assert got[("STOCKOUT_FOSA.ANY", "202608", "R")] == 3  # F1 counted once despite two antigens
    assert got[("STOCKOUT_FOSA.ANY", "202608", "P1")] == 2
    assert got[("STOCKOUT_FOSA.l1bhrYUPsde", "202608", "Z1")] == 1
    # Covered units without stock-out get an explicit 0, not a missing row.
    assert got[("STOCKOUT_FOSA.l1bhrYUPsde", "202608", "Z2")] == 0
    assert got[("STOCKOUT_FOSA.BfoCv6bUeBk", "202608", "Z3")] == 0  # HPV


def test_count_stockouts_denominator_is_facilities_managing_the_antigen():
    so, cmm = dhis2.STOCKOUT_COC, dhis2.CMM_COC
    analytics = {
        "metaData": {"ouHierarchy": {"F1": "R/P1/Z1/A1", "F2": "R/P1/Z1/A1", "F3": "R/P1/Z2/A2"}},
        "rows": [
            [f"uAWIVDnGPGH.{cmm}", "202608", "F1", "120"],
            [f"uAWIVDnGPGH.{so}", "202608", "F1", "4"],
            [f"uAWIVDnGPGH.{cmm}", "202608", "F2", "80"],
            [f"uAWIVDnGPGH.{so}", "202608", "F3", "2"],  # stock-out without CMM still manages Penta
            [f"l1bhrYUPsde.{cmm}", "202608", "F3", "0"],  # no consumption: not counted
        ],
    }
    got = {
        (r["indicator_id"], r["period"], r["org_unit"]): r["value"]
        for r in dhis2.count_stockouts([("P1", "202608", analytics)], "R", {"P1": ["Z1", "Z2"]}, ["P1"])
    }
    assert got[("STOCKOUT_FOSA.uAWIVDnGPGH", "202608", "R")] == 2
    assert got[("STOCKOUT_BASE.uAWIVDnGPGH", "202608", "R")] == 3
    assert got[("STOCKOUT_BASE.uAWIVDnGPGH", "202608", "Z1")] == 2
    assert got[("STOCKOUT_BASE.ANY", "202608", "P1")] == 3
    assert got[("STOCKOUT_BASE.l1bhrYUPsde", "202608", "P1")] == 0
    # CMM rows never count as stock-outs.
    assert got[("STOCKOUT_FOSA.uAWIVDnGPGH", "202608", "Z1")] == 1


def test_count_stockouts_never_reports_a_partial_national_figure():
    so = dhis2.STOCKOUT_COC
    analytics = {"metaData": {"ouHierarchy": {"F1": "R/P1/Z1/A1"}}, "rows": [[f"l1bhrYUPsde.{so}", "202608", "F1", "3"]]}
    zones = {"P1": ["Z1"], "P2": ["Z3"]}
    # P2's request failed: P2 and its zones stay unknown, and so does the national total.
    got = {
        (r["indicator_id"], r["period"], r["org_unit"]): r["value"]
        for r in dhis2.count_stockouts([("P1", "202608", analytics)], "R", zones, ["P1", "P2"])
    }
    assert got[("STOCKOUT_FOSA.l1bhrYUPsde", "202608", "P1")] == 1
    assert not any(ou in ("R", "P2", "Z3") for _, _, ou in got)


def test_all_definitions_have_unique_ids_and_units():
    ids = [d["id"] for d in dhis2.ALL_DEFINITIONS]
    assert len(ids) == len(set(ids))
    assert all(d["unit"] in ("count", "percent") for d in dhis2.ALL_DEFINITIONS)


def test_thematic_zones_only_weekly_or_backfill():
    daily = dhis2.thematic_targets("incremental", "R", ["P1", "P2"])
    assert daily == [("R", None), ("R", 2)]
    assert dhis2.thematic_targets("annual", "R", ["P1"]) == [("R", None), ("R", 2)]
    for scope in ("weekly", "full", "history", "thematic"):
        assert dhis2.thematic_targets(scope, "R", ["P1", "P2"])[-2:] == [("P1", 3), ("P2", 3)]


def test_supabase_writes_are_retried_with_a_fresh_client(monkeypatch):
    from app.etl import loaders
    calls = {"n": 0}
    monkeypatch.setattr(loaders, "_get_client", lambda: object())
    monkeypatch.setattr(loaders.time, "sleep", lambda _s: None)

    def flaky(_client):
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("StreamReset")
        return "ok"

    assert loaders._with_retry(flaky, "test") == "ok"
    assert calls["n"] == 3


def test_long_period_requests_are_split_into_windows():
    months = ";".join(f"2026{m:02d}" for m in range(1, 9)) + ";" + ";".join(f"2025{m:02d}" for m in range(1, 13))
    out = dhis2._windowed([(["dx"], months, "R", 2), (["dx"], "2026", "R", None)])
    assert [len(p.split(";")) for _, p, _, _ in out] == [6, 6, 6, 2, 1]
    assert all(ou == "R" for _, _, ou, _ in out)
