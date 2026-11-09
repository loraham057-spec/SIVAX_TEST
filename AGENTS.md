# AGENTS.md

## Environment
- Node is installed via nvm and is not on the default PATH: `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"`.
- Backend Python venv: `backend/venv`.

## Verification
- Typecheck: `npx tsc --noEmit -p tsconfig.json`
- Lint: `npx eslint src` (warnings exist; 0 errors expected)
- Frontend tests: `npx tsx --test src/lib/__tests__/*.test.ts`
- Backend tests: `cd backend && venv/bin/python -m pytest -q tests`

## DHIS2 / ETL
- ETL CLI: `cd backend && venv/bin/python -m app.etl.cli --scope <scope>`
  - incremental (Wednesday 03:00 UTC): 3 last complete months; PEV indicators at national + provinces + zones; thematic pages at national + provinces; FOSA stock-outs at all levels
  - weekly (Sunday 04:00 UTC, alias `full`): same window, plus the zone level of the thematic pages
  - annual (1st of the month 08:00 UTC): yearly aggregates + population data elements (Cibles page)
  - history (manual): older months, one window per run: `ETL_MONTHS=6` with `ETL_MONTHS_OFFSET=3`, `=9`, `=15`, `=21` walks back 24 months. Windows are relative to today: if the runs straddle a month change, add 1 to the remaining offsets.
  - thematic (manual): thematic pages only (backfill), window via `ETL_MONTHS`
- SNIS RDC drops any request > ~90 s: the ETL splits periods into windows of `ETL_PERIOD_WINDOW` (default 6) months. A 24-month refresh needs ~2 000 requests (8–20 h), hence history is loaded once, not weekly.
- Vaccine stock is in the SIGL ESS 2025 dataset (DxDuYrrZSa7, operands `<DE>.<COC>`); PEV form section B 6.1 is empty since 2025.
- `STOCKOUT_FOSA.<DE>` / `STOCKOUT_FOSA.ANY` are ETL-computed counts of facilities (level 5) with ≥ 1 stock-out day; % = ÷ `STOCKOUT_BASE.<DE>` / `STOCKOUT_BASE.ANY` (facilities with a CMM or a stock-out for the antigen). Never divide by `DxDuYrrZSa7.ACTUAL_REPORTS`: SIGL also covers non-vaccinating facilities (Kinshasa: 1 976 reports vs ~570 facilities managing Penta). Explicit 0 rows are written for covered units; the national row only when every province was covered. No row = unknown (UI shows "—").
- Deployment is AWS EKS: ETL jobs are the CronJobs in `infra/k8s/base/etl-cronjob.yaml`, reconciled by Flux. Both dev and prod overlays include them and share the same Supabase (the run lock prevents overlaps). The CloudWatch alarm `etl-no-success` fires after 5 days without a successful sync. `infra/modules/runtime-aca` (Azure) is not deployed.
- Runs are recorded in `etl_runs`; a lock prevents concurrent runs, runs stuck > 3h are marked failed.
- SNIS RDC is slow/unstable: analytics queries can take > 60 s; never point interactive UI at it when the ETL snapshot can serve.
- Analytics pages read `POST /api/dhis2/page-data` (ETL snapshot: selected org unit + direct children); DHIS2 live is a single-attempt fallback.
- PEV thresholds: single source `src/lib/pev/thresholds.json` (two bounds, three bands: beyond `warning` = critical, between = warning, `target` reached = good; coverage 80/90 per WHO IA2030). The backend agent mirrors it in `semantic_layer.PEV_THRESHOLDS`, checked by `backend/tests/test_pev_thresholds.py`. Coverage > 100 % / negative dropout = suspect data (`isSuspectValue`).
- Wastage page: antigen selector (SIGL vaccines, `src/lib/pev/sigl.ts`, shared with Supply). Wastage rate per antigen = (`<DE>.pdKyvaYRqCj` used − `<DE>.dxDQKDcTn6Z` administered) ÷ used, same formula as DHIS2 "LMIS … (Taux de perte)"; `YM7Tmn01ieL` = same formula over all vaccines. `J8mw9rFkY4v` "Pertes" = unopened-vial losses only (1–4 %), not the wastage rate. Per-antigen bounds: `thresholds.json` `wastage_by_antigen` (WHO indicative rates by presentation, exported as `WASTAGE_BY_ANTIGEN`). Negative rate = suspect.
- VAP = vaccin antipaludique (malaria, phased introduction; VAP4 = 12-23 months), not polio (polio = VPO / VPI).
- Performance page ranks cumulative values over the period: coverage = day-weighted mean of annualized monthly rates (`cumulativeAnnualized`), dropout = (ΣPenta1 − ΣPenta3 doses) / ΣPenta1 (`cumulativeRatio`). Province maps are only rendered at the national level (base map = provinces). Its "Où agir en priorité" card (`performance-action-card.tsx`) loads every zone via `page-data` `childLevel: 3` (response `parents` = province of each zone) and colours provinces by the share of zones in the critical band (`zones_below_threshold`), or shows children lost between Penta1 and Penta3 (Σ doses, `cumulativeTotals`). Zone-level PEV history in the snapshot is shorter than the province one.
- Analytics page filters: each page calls `usePageFilter(maxLevel)` (`_shared.tsx`) and passes `maxLevel` to `Dhis2FilterBar`: Supply, Cold chain, Management and Surveillance stop at the zone (3); Performance and Data quality at the aire (4). The antigen selector (`showAntigen`) is only on Coverage (and the explorer). The bar does not offer "this month" / "last month" / "year over year"; it offers `LAST_COMPLETE_MONTH` (M-2) instead.
