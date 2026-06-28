# Synthszr Rankings Phase 0 — Progress Ledger

Plan: docs/superpowers/plans/2026-06-28-synthszr-rankings-phase0.md
Branch: main

- Task 1 (Schema-Migration): complete (commit 86307e3, prod-verified)
- Task 2 (parseProductName): complete (commit 1b325c6, review clean)
  - MINOR (für Final-Review): version-regex [a-z]? erlaubt nur 1 Suffix-Buchstabe; "4rc"/"4b1" → family statt qualifier. Kein Spec-Test betroffen.
- Task 3 (canonicalKey/slug/alias): complete (commits 5274390 + fix b279144, review clean, 20/20)
- Task 4 (ranking_jobs lease+skeleton): complete (commit 64b80e9, review clean, 4/4, build clean)
- Final review: pending
