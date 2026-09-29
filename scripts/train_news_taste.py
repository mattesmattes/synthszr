# /// script
# requires-python = ">=3.11"
# dependencies = ["scikit-learn>=1.4", "lightgbm>=4.3,<5", "numpy>=1.26"]
# ///
"""News-Taste-Training: LR vs. LightGBM-Klassifikator vs. LightGBM-Ranker.

Temporaler Split (aelteste 80% der (gefilterten) Tage = Training, juengste 20%
= Test), Bewertung PRO TAG als Ranking (Recall@10/15, NDCG@15 — Formeln
identisch zu lib/news-queue/metrics.ts).

Task 8c (R29): Gewinnerwahl auf innerer Validierung, NIE auf dem Test.
- Die juengsten 20% der Trainingstage (chronologisch) sind Validierung, der
  Rest ist "fit-Train". Alle Kandidaten (logreg, lightgbm, lightgbm_ranker)
  werden auf fit-Train gefittet und per Tages-NDCG@15 auf der Validierung
  verglichen; der Beste gewinnt (exakter Gleichstand: Reihenfolge in
  CANDIDATES, einfachstes Modell zuerst). Der Ranker nutzt die Validierung
  fuer Early Stopping (eval_at=[15]).
- Danach werden die Kandidaten auf ALLEN Trainingstagen neu gefittet (Ranker
  mit der auf Validierung gefundenen Iterationszahl, ohne Early Stopping) und
  auf dem Test berichtet. Nur der Gewinner wird exportiert; die Refits der
  uebrigen dienen dem Bericht (gleiche Datenmenge wie der Gewinner, damit
  Test- und Gate-Zeilen vergleichbar sind). Testmetriken fliessen nicht in
  die Wahl ein.
- total_score_baseline rankt nach dem echten Feature `total_score` (Task 8b,
  DB-Wert); die Rekonstruktion der Produktionsformel entfaellt.
- Artefakt: Gewinnt der Ranker, ist model_type 'lightgbm' mit den
  tree_structure-Baeumen; die TS-Inferenz wendet sigmoid auf die Baumsumme an
  (monoton, ranking-neutral). Paritaet Ranker: Baum-Walk-Summe vs.
  booster_.predict(X, raw_score=True).

Weiterhin gueltig (Task 8, R24-R26):
- Abbruch bei abweichender features_version.
- R24: Tage vor MIN_DAY (2026-03-29) werden VOR dem Split verworfen
  (source_pub_rate-Label-Leak durch rueckwirkende Befuellung per Migration
  20260328_optimized_scoring.sql). Ablation ohne Quellen-Features (inkl.
  total_score, das source_pub_rate*17.5 enthaelt) — nur Metriken.
- Parity-Check (mandatory) fuer ALLE Kandidaten, NaN-sicher, Toleranz 1e-6;
  Reload-Check fuer den Gewinner; Artefakt atomar (Temp-Datei + Rename).
- R25/R26: Gate-Vergleich apples-to-apples je Reranker-Lauf im Testzeitraum
  (Pool = Lauftag + Vortag, relevant = binnen 48h veroeffentlicht ∩ Pool):
  Modell (Gewinner), Reranker, total_score, Zufall — plus jeder Kandidat.

Lauf: npm run taste:train   (uv run scripts/train_news_taste.py)
"""
import datetime
import json
import math
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
from lightgbm import LGBMClassifier, LGBMRanker
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "taste-dataset.json"
BASELINE = ROOT / "reranker-baseline.json"
ARTIFACT = ROOT / "taste-model.json"
REPORT = ROOT / "taste-train-report.json"
FEATURES_VERSION = 1  # muss lib/news-taste/questions.ts entsprechen

# R24: source_pub_rate ist vor diesem Datum rueckwirkend aus dem gesamten
# (auch zukuenftigen) Post-Bestand befuellt worden — Label-Leak. Ab hier ist
# es Punkt-in-Zeit (lib/synthesis/pipeline.ts getSourcePubRates).
MIN_DAY = "2026-03-29"

SEED = 0
PARITY_SAMPLE_SIZE = 50
PARITY_TOLERANCE = 1e-6

TEST_FRACTION = 0.2        # juengste 20% der Tage = Test
VALIDATION_FRACTION = 0.2  # juengste 20% der TRAININGS-Tage = Validierung

# Reihenfolge = Tie-Break bei exakt gleicher Validierungs-NDCG@15 (einfachstes zuerst).
CANDIDATES = ("logreg", "lightgbm", "lightgbm_ranker")

LOGREG_PARAMS = dict(max_iter=2000, C=1.0, class_weight="balanced", random_state=SEED)
LGBM_CLASSIFIER_PARAMS = dict(
    n_estimators=300, learning_rate=0.05, num_leaves=31, min_child_samples=20,
    class_weight="balanced", random_state=SEED, verbose=-1,
    deterministic=True, force_row_wise=True,
)
# Feste, bescheidene Hyperparameter (keine Suche). n_estimators ist nur die
# Obergrenze fuer das Early Stopping auf der Validierung.
LGBM_RANKER_PARAMS = dict(
    objective="lambdarank", learning_rate=0.05, num_leaves=31, min_child_samples=20,
    random_state=SEED, verbose=-1, deterministic=True, force_row_wise=True,
)
RANKER_MAX_ESTIMATORS = 1000
RANKER_EARLY_STOPPING_ROUNDS = 50
RANKER_EVAL_AT = [15]

# total_score enthaelt source_pub_rate*17.5 — ohne es wuerde die Ablation den
# Quellen-Prior ueber die Hintertuer wieder hereinholen.
ABLATION_EXCLUDED_FEATURES = {"source_pub_rate", "source_bonus", "total_score"}


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for i in ranked[:k] if i in relevant) / len(relevant)


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, x in enumerate(ranked[:k]) if x in relevant)
    ideal = min(len(relevant), k)
    idcg = sum(1 / math.log2(i + 2) for i in range(ideal))
    return dcg / idcg if idcg else 0.0


def _harmonic_discounts(k: int) -> list[float]:
    return [1 / math.log2(i + 2) for i in range(k)]


def expected_recall_at_k(n: int, r: int, k: int) -> float:
    """Erwarteter Recall@k einer zufaelligen Reihenfolge (exakt, Linearitaet
    des Erwartungswerts: jede Position hat Trefferwahrscheinlichkeit r/n)."""
    if r == 0 or n == 0:
        return 0.0
    return min(k, n) / n


def expected_ndcg_at_k(n: int, r: int, k: int) -> float:
    """Erwarteter NDCG@k einer zufaelligen Reihenfolge (exakt: IDCG ist
    deterministisch gegeben r, nur DCG ist die Zufallsvariable)."""
    if r == 0 or n == 0:
        return 0.0
    kk = min(k, n)
    e_dcg = (r / n) * sum(_harmonic_discounts(kk))
    ideal_hits = min(r, k)
    idcg = sum(_harmonic_discounts(ideal_hits))
    return e_dcg / idcg if idcg else 0.0


def rank_days(days, score_fn) -> dict:
    r10, r15, ndcg = [], [], []
    for d in days:
        ids = [it["id"] for it in d["items"]]
        scores = score_fn(np.array([it["x"] for it in d["items"]], dtype=float))
        order = [ids[i] for i in np.argsort(-scores)]
        rel = {it["id"] for it in d["items"] if it["label"]}
        r10.append(recall_at_k(order, rel, 10))
        r15.append(recall_at_k(order, rel, 15))
        ndcg.append(ndcg_at_k(order, rel, 15))
    return {
        "recall_at_10": float(np.mean(r10)),
        "recall_at_15": float(np.mean(r15)),
        "ndcg_at_15": float(np.mean(ndcg)),
    }


def expected_random_metrics(days) -> dict:
    """Erwartungswert von Recall@10/15 und NDCG@15 einer zufaelligen Reihenfolge,
    pro Tag exakt berechnet, dann ueber Tage gemittelt wie bei den echten
    Modellen. Dient als Referenz-Boden."""
    r10, r15, ndcg = [], [], []
    for d in days:
        n = len(d["items"])
        r = sum(1 for it in d["items"] if it["label"])
        r10.append(expected_recall_at_k(n, r, 10))
        r15.append(expected_recall_at_k(n, r, 15))
        ndcg.append(expected_ndcg_at_k(n, r, 15))
    return {
        "recall_at_10": float(np.mean(r10)),
        "recall_at_15": float(np.mean(r15)),
        "ndcg_at_15": float(np.mean(ndcg)),
    }


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def lr_predict_from_export(weights: list[float], bias: float, X: np.ndarray) -> np.ndarray:
    return sigmoid(bias + X @ np.array(weights, dtype=float))


def _walk_lgbm_tree(node: dict, x: np.ndarray) -> float:
    # WARUM keine extra Konstante: LightGBM faltet den init_score
    # (boost_from_average bei binaerer Klassifikation) automatisch in die
    # Blattwerte von Baum 0 ein — dump_model()'s tree_structure reproduziert
    # predict_proba() daher bereits exakt ohne Offset (empirisch verifiziert,
    # s. Parity-Check unten und Report). lambdarank hat gar kein
    # boost_from_average. Falls ein kuenftiger LightGBM-Lauf doch einen Offset
    # braeuchte, wuerde der Parity-Check das mit einem harten Abbruch anzeigen
    # statt still ein falsches Artefakt zu exportieren.
    while "leaf_value" not in node:
        assert node["decision_type"] == "<=", f"unerwarteter decision_type: {node['decision_type']}"
        missing_type = node.get("missing_type", "None")
        assert missing_type in ("None", None), (
            f"unerwarteter missing_type: {missing_type!r} — unsere Features haben nie "
            "fehlende Werte, der TS-Baum-Walk kennt keine missing-value-Behandlung."
        )
        f = node["split_feature"]
        if x[f] <= node["threshold"]:
            node = node["left_child"]
        else:
            node = node["right_child"]
    return node["leaf_value"]


def lgbm_raw_from_trees(trees: list[dict], X: np.ndarray) -> np.ndarray:
    return np.array([sum(_walk_lgbm_tree(t, x) for t in trees) for x in X], dtype=float)


def lgbm_predict_from_trees(trees: list[dict], X: np.ndarray) -> np.ndarray:
    return sigmoid(lgbm_raw_from_trees(trees, X))


def stack_days(days) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """X/y in Tagesreihenfolge, Items in Dataset-Reihenfolge; groups = Items
    je Tag (LGBMRanker verlangt zusammenhaengende Gruppen)."""
    X = np.array([it["x"] for d in days for it in d["items"]], dtype=float)
    y = np.array([1 if it["label"] else 0 for d in days for it in d["items"]], dtype=int)
    groups = [len(d["items"]) for d in days]
    assert sum(groups) == len(X)
    return X, y, groups


def split_info(days) -> dict:
    return {
        "days": len(days),
        "first_day": days[0]["day"],
        "last_day": days[-1]["day"],
        "items": sum(len(d["items"]) for d in days),
        "positives": sum(1 for d in days for it in d["items"] if it["label"]),
    }


def fit_logreg(X: np.ndarray, y: np.ndarray) -> dict:
    # Standardisiert; class_weight balanced: ~2-5% Positive, sonst lernt sie
    # nur die Mehrheitsklasse.
    means, stds = X.mean(axis=0), X.std(axis=0)
    stds[stds == 0] = 1.0
    lr = LogisticRegression(**LOGREG_PARAMS)
    lr.fit((X - means) / stds, y)
    return {
        "model": lr, "means": means, "stds": stds,
        "score_fn": lambda A: lr.decision_function((A - means) / stds),
    }


def fit_lgbm_classifier(X: np.ndarray, y: np.ndarray) -> dict:
    clf = LGBMClassifier(**LGBM_CLASSIFIER_PARAMS)
    clf.fit(X, y)
    return {"model": clf, "score_fn": lambda A: clf.predict_proba(A)[:, 1]}


def fit_lgbm_ranker(X, y, groups, n_estimators: int, validation=None) -> dict:
    """validation=(X_val, y_val, groups_val): Early Stopping auf NDCG@15 der
    Validierung. Ohne validation: fester Refit mit n_estimators Baeumen."""
    ranker = LGBMRanker(n_estimators=n_estimators, **LGBM_RANKER_PARAMS)
    if validation is None:
        ranker.fit(X, y, group=groups)
        num_iteration = n_estimators
    else:
        X_val, y_val, groups_val = validation
        ranker.fit(
            X, y, group=groups,
            eval_set=[(X_val, y_val)], eval_group=[groups_val], eval_at=RANKER_EVAL_AT,
            callbacks=[lgb.early_stopping(RANKER_EARLY_STOPPING_ROUNDS, first_metric_only=True, verbose=False)],
        )
        metric_names = list(ranker.best_score_["valid_0"].keys())
        assert metric_names == ["ndcg@15"], f"unerwartete Early-Stopping-Metriken: {metric_names}"
        num_iteration = int(ranker.best_iteration_)
        assert num_iteration >= 1, f"best_iteration_ ungueltig: {num_iteration}"
    booster = ranker.booster_
    return {
        "model": ranker, "num_iteration": num_iteration,
        "score_fn": lambda A: booster.predict(A, raw_score=True, num_iteration=num_iteration),
    }


def fit_candidates(train_days, validation_days=None, ranker_n_estimators: int | None = None) -> dict:
    X, y, groups = stack_days(train_days)
    fits = {
        "logreg": fit_logreg(X, y),
        "lightgbm": fit_lgbm_classifier(X, y),
    }
    if validation_days is not None:
        fits["lightgbm_ranker"] = fit_lgbm_ranker(
            X, y, groups, RANKER_MAX_ESTIMATORS, validation=stack_days(validation_days),
        )
    else:
        fits["lightgbm_ranker"] = fit_lgbm_ranker(X, y, groups, ranker_n_estimators)
    assert tuple(fits) == CANDIDATES
    return fits


def dump_trees(booster, expected_trees: int) -> list[dict]:
    dump = booster.dump_model()
    trees = [t["tree_structure"] for t in dump["tree_info"]]
    assert len(trees) == booster.num_trees() == expected_trees, (
        f"Baumanzahl inkonsistent: dump={len(trees)} booster={booster.num_trees()} erwartet={expected_trees}"
    )
    return trees


def score_pool_ids(pool_items: list[dict], score_fn) -> list[str]:
    ids = [it["id"] for it in pool_items]
    X_pool = np.array([it["x"] for it in pool_items], dtype=float)
    scores = score_fn(X_pool)
    return [ids[i] for i in np.argsort(-scores)]


def _order_metrics(order: list[str], relevant: set[str]) -> dict:
    return {
        "r10": recall_at_k(order, relevant, 10),
        "r15": recall_at_k(order, relevant, 15),
        "ndcg15": ndcg_at_k(order, relevant, 15),
    }


def compute_gate_comparison(test_days, day_index: dict, per_run: list[dict], score_fns: dict) -> dict:
    """R25: apples-to-apples Gate-Vergleich. Fuer jeden Reranker-Lauf im
    Testzeitraum: Pool = Datensatz-Items von Lauftag + Vortag, relevant =
    binnen 48h veroeffentlichte Items (aus der Baseline-Messung) geschnitten
    mit dem Pool. Alle score_fns (Modell = Gewinner, total_score (R26), jeder
    Kandidat (8c)) und der Reranker ranken denselben Pool/dieselben
    relevanten Items; Random ist der exakte Erwartungswert auf demselben Pool."""
    test_day_set = {d["day"] for d in test_days}
    rows = []
    for run in per_run:
        day = run.get("day")
        if day not in test_day_set or day not in day_index:
            continue
        pool_items = list(day_index[day]["items"])
        prev_day = (datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat()
        if prev_day in day_index:
            pool_items = pool_items + list(day_index[prev_day]["items"])
        pool_ids = {it["id"] for it in pool_items}
        relevant = set(run.get("relevant_ids") or []) & pool_ids
        if not relevant:
            continue

        n_pool, n_rel = len(pool_items), len(relevant)
        row = {"runId": run.get("runId"), "day": day, "n_pool": n_pool, "n_relevant": n_rel}
        for name, fn in score_fns.items():
            row[name] = _order_metrics(score_pool_ids(pool_items, fn), relevant)
        row["reranker"] = _order_metrics(run.get("suggested_ids") or [], relevant)
        row["random"] = {
            "r10": expected_recall_at_k(n_pool, n_rel, 10),
            "r15": expected_recall_at_k(n_pool, n_rel, 15),
            "ndcg15": expected_ndcg_at_k(n_pool, n_rel, 15),
        }
        rows.append(row)

    groups = list(score_fns) + ["reranker", "random"]
    if not rows:
        return {"runs_used": 0, **{g: None for g in groups}, "rows": []}

    def summarize(group: str) -> dict:
        return {
            "recall_at_10": float(np.mean([r[group]["r10"] for r in rows])),
            "recall_at_15": float(np.mean([r[group]["r15"] for r in rows])),
            "ndcg_at_15": float(np.mean([r[group]["ndcg15"] for r in rows])),
        }

    return {"runs_used": len(rows), **{g: summarize(g) for g in groups}, "rows": rows}


def print_comparison_table(title: str, rows: list[tuple[str, dict | None]]) -> None:
    print(title)
    name_width = max(42, max((len(name) for name, _ in rows), default=0) + 2)
    header = f"{'model':<{name_width}}{'R@10':>8}{'R@15':>8}{'NDCG@15':>10}"
    print(header)
    print("-" * len(header))
    for name, m in rows:
        if m is None:
            print(f"{name:<{name_width}}{'n/a':>8}{'n/a':>8}{'n/a':>10}")
            continue
        print(f"{name:<{name_width}}{m['recall_at_10']:>8.4f}{m['recall_at_15']:>8.4f}{m['ndcg_at_15']:>10.4f}")


def fmt_split(label: str, info: dict) -> str:
    return (
        f"  {label:<10} {info['days']:>3} Tage  {info['first_day']}..{info['last_day']}  "
        f"{info['items']:>6} Items  {info['positives']:>4} pos"
    )


def main() -> None:
    data = json.loads(DATASET.read_text())

    ds_version = data.get("features_version")
    if ds_version != FEATURES_VERSION:
        print(
            f"ERROR: taste-dataset.json hat features_version={ds_version!r}, "
            f"Skript erwartet FEATURES_VERSION={FEATURES_VERSION!r}. Abbruch.",
            file=sys.stderr,
        )
        sys.exit(1)

    names = data["feature_names"]
    days_all = sorted(data["days"], key=lambda d: d["day"])

    # --- R24: Tage vor MIN_DAY verwerfen (source_pub_rate Label-Leak) ---
    days_dropped = [d for d in days_all if d["day"] < MIN_DAY]
    days = [d for d in days_all if d["day"] >= MIN_DAY]
    print(
        f"MIN_DAY={MIN_DAY} (R24, source_pub_rate Label-Leak vor diesem Datum): "
        f"{len(days_dropped)} von {len(days_all)} Tagen verworfen, {len(days)} Tage behalten."
    )
    if not days:
        print("ERROR: nach MIN_DAY-Filter bleiben keine Tage übrig. Abbruch.", file=sys.stderr)
        sys.exit(1)

    day_index = {d["day"]: d for d in days}

    # --- Split: Test = juengste 20% der Tage; Validierung = juengste 20% der Trainingstage ---
    cut = int(len(days) * (1 - TEST_FRACTION))
    train_days, test_days = days[:cut], days[cut:]
    val_cut = int(len(train_days) * (1 - VALIDATION_FRACTION))
    fit_days, val_days = train_days[:val_cut], train_days[val_cut:]
    assert fit_days and val_days and test_days
    assert fit_days[-1]["day"] < val_days[0]["day"] <= val_days[-1]["day"] < test_days[0]["day"], "Split nicht chronologisch"

    split = {
        "train_all": split_info(train_days),
        "fit_train": split_info(fit_days),
        "validation": split_info(val_days),
        "test": split_info(test_days),
    }
    print("Split (chronologisch):")
    print(fmt_split("fit-Train", split["fit_train"]))
    print(fmt_split("Valid.", split["validation"]))
    print(fmt_split("Train ges.", split["train_all"]) + "  (Refit)")
    print(fmt_split("Test", split["test"]))

    i_total = names.index("total_score")
    total_score_fn = lambda A: A[:, i_total]

    # --- Phase 1: Kandidaten auf fit-Train, Vergleich auf Validierung (Test unberuehrt) ---
    selection_fits = fit_candidates(fit_days, validation_days=val_days)
    best_iteration = selection_fits["lightgbm_ranker"]["num_iteration"]
    print(f"lightgbm_ranker Early Stopping (Validierung, NDCG@15): best_iteration={best_iteration} (max {RANKER_MAX_ESTIMATORS})")

    validation_metrics = {c: rank_days(val_days, selection_fits[c]["score_fn"]) for c in CANDIDATES}
    validation_baselines = {
        "total_score_baseline": rank_days(val_days, total_score_fn),
        "random_baseline": expected_random_metrics(val_days),
    }

    # max() liefert bei Gleichstand das erste Element -> Reihenfolge in CANDIDATES.
    winner = max(CANDIDATES, key=lambda c: validation_metrics[c]["ndcg_at_15"])
    val_ndcg = {c: validation_metrics[c]["ndcg_at_15"] for c in CANDIDATES}
    winner_reason = {
        "rule": (
            "hoechste Tages-NDCG@15 auf der Validierung (Fit ohne Validierung); "
            "exakter Gleichstand -> Reihenfolge logreg, lightgbm, lightgbm_ranker; "
            "Testzeitraum nicht verwendet"
        ),
        "validation_ndcg_at_15": val_ndcg,
    }

    # Test-Metriken der Selektions-Fits (nur Bericht, nicht fuer die Wahl).
    test_metrics_selection_fit = {c: rank_days(test_days, selection_fits[c]["score_fn"]) for c in CANDIDATES}

    # --- Phase 2: Refit auf allen Trainingstagen (Ranker mit best_iteration), Test-Bericht ---
    fits = fit_candidates(train_days, ranker_n_estimators=best_iteration)
    test_metrics = {c: rank_days(test_days, fits[c]["score_fn"]) for c in CANDIDATES}
    winner_fit = fits[winner]
    model_type = "logreg" if winner == "logreg" else "lightgbm"

    # --- Baselines auf dem Test ---
    i_syn = names.index("synthesis_score")
    i_rel = names.index("relevance_score")
    i_unq = names.index("uniqueness_score")
    i_bon = names.index("source_bonus")

    def legacy_formula(A: np.ndarray) -> np.ndarray:
        # Alte Formel vor der Migration — nur noch zum Vergleich.
        return 0.4 * A[:, i_syn] + 0.3 * A[:, i_rel] + 0.3 * A[:, i_unq] + A[:, i_bon]

    total_score_m = rank_days(test_days, total_score_fn)
    legacy_m = rank_days(test_days, legacy_formula)
    random_m = expected_random_metrics(test_days)

    # --- R24 Ablation: LR ohne Quellen-Features (auf allen Trainingstagen, nur Metriken) ---
    X_train, y_train, _ = stack_days(train_days)
    keep_idx = [i for i, n in enumerate(names) if n not in ABLATION_EXCLUDED_FEATURES]
    ablation_fit = fit_logreg(X_train[:, keep_idx], y_train)
    ablation_m = rank_days(test_days, lambda A: ablation_fit["score_fn"](A[:, keep_idx]))
    print(
        f"Ablation logreg_no_source_features (ohne {sorted(ABLATION_EXCLUDED_FEATURES)}): "
        f"R@15={ablation_m['recall_at_15']:.4f} NDCG@15={ablation_m['ndcg_at_15']:.4f} "
        f"(volles LR: R@15={test_metrics['logreg']['recall_at_15']:.4f} NDCG@15={test_metrics['logreg']['ndcg_at_15']:.4f})"
    )

    # --- Export-Parameter fuer ALLE Kandidaten (Refits) ---
    lr, means, stds = fits["logreg"]["model"], fits["logreg"]["means"], fits["logreg"]["stds"]
    lr_weights = [float(w / s) for w, s in zip(lr.coef_[0], stds)]  # entstandardisiert …
    lr_bias = float(lr.intercept_[0] - float(np.dot(lr.coef_[0], means / stds)))  # … Bias angepasst

    clf = fits["lightgbm"]["model"]
    clf_trees = dump_trees(clf.booster_, LGBM_CLASSIFIER_PARAMS["n_estimators"])
    ranker = fits["lightgbm_ranker"]["model"]
    ranker_trees = dump_trees(ranker.booster_, best_iteration)
    trees_by_candidate = {"lightgbm": clf_trees, "lightgbm_ranker": ranker_trees}

    # --- Parity-Check (mandatory, alle Kandidaten, ~50 Testzeilen, Original-x) ---
    rng = np.random.RandomState(SEED)
    test_X, _, _ = stack_days(test_days)
    n_sample = min(PARITY_SAMPLE_SIZE, len(test_X))
    sample_idx = rng.choice(len(test_X), n_sample, replace=False)
    sample_X = test_X[sample_idx]

    def reference(candidate: str, X_: np.ndarray) -> np.ndarray:
        # LR/Klassifikator: Wahrscheinlichkeit; Ranker: roher Score (beide Seiten ohne sigmoid).
        if candidate == "logreg":
            return lr.predict_proba((X_ - means) / stds)[:, 1]
        if candidate == "lightgbm":
            return clf.predict_proba(X_)[:, 1]
        return ranker.booster_.predict(X_, raw_score=True)

    def from_export(candidate: str, X_: np.ndarray, weights, bias, trees) -> np.ndarray:
        if candidate == "logreg":
            return lr_predict_from_export(weights, bias, X_)
        if candidate == "lightgbm":
            return lgbm_predict_from_trees(trees, X_)
        return lgbm_raw_from_trees(trees, X_)

    parity_diffs = {}
    for c in CANDIDATES:
        manual = from_export(c, sample_X, lr_weights, lr_bias, trees_by_candidate.get(c))
        parity_diffs[c] = float(np.max(np.abs(manual - reference(c, sample_X))))
    print(
        f"Parity (in-memory export params, n={n_sample}): "
        + "  ".join(f"{c} max diff={parity_diffs[c]:.3e}" for c in CANDIDATES)
        + "  (Ranker: roher Score)"
    )
    # NaN-sicher: "not (diff <= tol)" faengt auch diff=NaN ab (NaN > tol waere False).
    failed = [c for c in CANDIDATES if not (parity_diffs[c] <= PARITY_TOLERANCE)]
    if failed:
        print(
            f"ERROR: Parity-Check fehlgeschlagen (Toleranz {PARITY_TOLERANCE:.0e}) fuer {failed}: "
            f"{parity_diffs}. Abbruch.",
            file=sys.stderr,
        )
        sys.exit(1)

    # TS wendet sigmoid auf die Ranker-Baumsumme an: nur ranking-neutral, solange
    # sigmoid keine verschiedenen Rohwerte zusammenfallen laesst (Saettigung).
    ranker_test_raw = ranker.booster_.predict(test_X, raw_score=True)
    ranker_sigmoid_check = {
        "test_raw_min": float(ranker_test_raw.min()),
        "test_raw_max": float(ranker_test_raw.max()),
        "distinct_raw": int(np.unique(ranker_test_raw).size),
        "distinct_after_sigmoid": int(np.unique(sigmoid(ranker_test_raw)).size),
    }
    print(
        f"Ranker sigmoid-Check (Testzeilen): raw [{ranker_sigmoid_check['test_raw_min']:.3f}, "
        f"{ranker_sigmoid_check['test_raw_max']:.3f}], distinct raw={ranker_sigmoid_check['distinct_raw']} "
        f"-> nach sigmoid={ranker_sigmoid_check['distinct_after_sigmoid']}"
    )
    if winner == "lightgbm_ranker" and ranker_sigmoid_check["distinct_after_sigmoid"] != ranker_sigmoid_check["distinct_raw"]:
        print("ERROR: sigmoid laesst Ranker-Scores zusammenfallen — TS-Ranking waere nicht identisch. Abbruch.", file=sys.stderr)
        sys.exit(1)

    artifact = {
        "features_version": FEATURES_VERSION,
        "model_type": model_type,
        "feature_names": names,
        "trained_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "train_days": len(train_days), "test_days": len(test_days),
        "metrics": test_metrics[winner],
        "logreg": None, "lightgbm": None,
    }
    if winner == "logreg":
        artifact["logreg"] = {
            "weights": lr_weights,
            "bias": lr_bias,
            "means": [0.0] * len(names), "stds": [1.0] * len(names),  # TS rechnet dann roh
        }
    else:
        artifact["lightgbm"] = {"trees": trees_by_candidate[winner]}

    # --- Atomar schreiben: erst Temp-Datei, Parity-Check auf dem Reload, dann Rename ---
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = ARTIFACT.with_suffix(ARTIFACT.suffix + ".tmp")
    tmp_path.write_text(json.dumps(artifact, allow_nan=False))

    reloaded = json.loads(tmp_path.read_text())
    assert reloaded["model_type"] == model_type
    if reloaded["model_type"] == "logreg":
        manual_reloaded = from_export("logreg", sample_X, reloaded["logreg"]["weights"], reloaded["logreg"]["bias"], None)
    else:
        manual_reloaded = from_export(winner, sample_X, None, None, reloaded["lightgbm"]["trees"])
    diff_reloaded = float(np.max(np.abs(manual_reloaded - reference(winner, sample_X))))
    print(f"Parity (reloaded artifact, winner={winner}): max diff={diff_reloaded:.3e}")
    if not (diff_reloaded <= PARITY_TOLERANCE):
        tmp_path.unlink(missing_ok=True)
        print(
            f"ERROR: Parity-Check nach Reload fehlgeschlagen (Toleranz {PARITY_TOLERANCE:.0e}). "
            f"diff={diff_reloaded}. Abbruch, Temp-Datei geloescht.",
            file=sys.stderr,
        )
        sys.exit(1)

    tmp_path.replace(ARTIFACT)  # atomarer Rename, erst jetzt existiert das Artefakt final
    print(f"Artefakt geschrieben: {ARTIFACT} (model_type={model_type})")

    # --- Reranker-Baseline: gesamt + auf dem Testzeitraum ---
    if not BASELINE.exists():
        print(f"WARNING: {BASELINE} nicht gefunden — Reranker-Baseline und Gate-Vergleich bleiben leer.", file=sys.stderr)
        baseline = {}
    else:
        baseline = json.loads(BASELINE.read_text())
    reranker_overall = {k: baseline.get(k) for k in ("runs_measured", "mean_recall_at_10", "mean_recall_at_15", "mean_ndcg_at_15")}

    per_run = baseline.get("per_run", [])
    first_test_day = test_days[0]["day"]
    last_test_day = test_days[-1]["day"]
    last_test_day_plus1 = (datetime.date.fromisoformat(last_test_day) + datetime.timedelta(days=1)).isoformat()
    test_period_runs = [r for r in per_run if first_test_day <= r["day"] <= last_test_day_plus1]
    if test_period_runs:
        reranker_test_period = {
            "runs_used": len(test_period_runs),
            "mean_recall_at_10": float(np.mean([r["r10"] for r in test_period_runs])),
            "mean_recall_at_15": float(np.mean([r["r15"] for r in test_period_runs])),
            "mean_ndcg_at_15": float(np.mean([r["ndcg15"] for r in test_period_runs])),
        }
    else:
        reranker_test_period = {"runs_used": 0, "mean_recall_at_10": None, "mean_recall_at_15": None, "mean_ndcg_at_15": None}

    # --- R25/R26/8c: Gate-Vergleich apples-to-apples, alle Kandidaten auf denselben Pools ---
    gate_score_fns = {"model": winner_fit["score_fn"], "total_score": total_score_fn}
    gate_score_fns.update({c: fits[c]["score_fn"] for c in CANDIDATES})
    gate_comparison = {"model_name": winner, **compute_gate_comparison(test_days, day_index, per_run, gate_score_fns)}
    if gate_comparison["runs_used"]:
        assert gate_comparison["model"] == gate_comparison[winner], "Gate: model-Zeile != Gewinner-Kandidat"

    report = {
        "winner": winner,
        "winner_model_type": model_type,
        "winner_reason": winner_reason,
        "min_day": MIN_DAY,
        "days_total_before_min_day_filter": len(days_all),
        "days_dropped_before_min_day": len(days_dropped),
        "days_kept_after_min_day_filter": len(days),
        "split": split,
        "hyperparameters": {
            "logreg": dict(LOGREG_PARAMS),
            "lightgbm": dict(LGBM_CLASSIFIER_PARAMS),
            "lightgbm_ranker": {
                **LGBM_RANKER_PARAMS, "n_estimators_max": RANKER_MAX_ESTIMATORS,
                "early_stopping_rounds": RANKER_EARLY_STOPPING_ROUNDS, "eval_at": RANKER_EVAL_AT,
                "best_iteration": best_iteration,
            },
        },
        "validation_metrics": validation_metrics,
        "validation_baselines": validation_baselines,
        "test_metrics": test_metrics,
        "test_metrics_note": (
            "test_metrics: Refit auf allen Trainingstagen (Ranker mit best_iteration) — der "
            "Gewinner-Eintrag entspricht dem exportierten Artefakt. test_metrics_selection_fit: "
            "die auf fit-Train gefitteten Selektionsmodelle. Beides nur Bericht, nicht Wahl."
        ),
        "test_metrics_selection_fit": test_metrics_selection_fit,
        "logreg_no_source_features": ablation_m,
        "total_score_baseline": total_score_m,
        "legacy_formula_baseline": legacy_m,
        "random_baseline": random_m,
        "reranker_baseline_overall": reranker_overall,
        "reranker_baseline_test_period": reranker_test_period,
        "gate_comparison": gate_comparison,
        "parity": {
            "sample_size": n_sample,
            "tolerance": PARITY_TOLERANCE,
            "logreg_max_diff": parity_diffs["logreg"],
            "lightgbm_max_diff": parity_diffs["lightgbm"],
            "lightgbm_ranker_max_diff": parity_diffs["lightgbm_ranker"],
            "lightgbm_ranker_compared_on": "raw_score (Baum-Walk-Summe vs. booster_.predict(raw_score=True))",
            "winner_reloaded_max_diff": diff_reloaded,
            "ranker_sigmoid_check": ranker_sigmoid_check,
        },
        "top_weights_standardized": sorted(zip(names, [float(w) for w in lr.coef_[0]]), key=lambda t: -abs(t[1]))[:12],
    }
    REPORT.write_text(json.dumps(report, indent=1, allow_nan=False))

    print()
    print(f"Gewinner: {winner} (model_type={model_type}) — Wahl auf Validierung, Validierungs-NDCG@15: "
          + ", ".join(f"{c}={val_ndcg[c]:.4f}" for c in CANDIDATES))
    print()
    mark = lambda c: f"{c}{' *' if c == winner else ''}"
    print_comparison_table(
        f"VALIDIERUNG ({split['validation']['days']} Tage {split['validation']['first_day']}..{split['validation']['last_day']}, "
        f"Fit auf {split['fit_train']['days']} Tagen; * = Gewinner):",
        [(mark(c), validation_metrics[c]) for c in CANDIDATES]
        + [("total_score_baseline (echte Spalte)", validation_baselines["total_score_baseline"]),
           ("random_baseline", validation_baselines["random_baseline"])],
    )
    print()
    reranker_test_row = None
    if reranker_test_period["runs_used"]:
        reranker_test_row = {
            "recall_at_10": reranker_test_period["mean_recall_at_10"],
            "recall_at_15": reranker_test_period["mean_recall_at_15"],
            "ndcg_at_15": reranker_test_period["mean_ndcg_at_15"],
        }
    reranker_overall_row = None
    if reranker_overall.get("mean_ndcg_at_15") is not None:
        reranker_overall_row = {
            "recall_at_10": reranker_overall["mean_recall_at_10"],
            "recall_at_15": reranker_overall["mean_recall_at_15"],
            "ndcg_at_15": reranker_overall["mean_ndcg_at_15"],
        }
    print_comparison_table(
        f"TEST ({split['test']['days']} Tage {split['test']['first_day']}..{split['test']['last_day']}, "
        f"Tages-Ranking; Kandidaten refit auf {split['train_all']['days']} Tagen):",
        [(mark(c), test_metrics[c]) for c in CANDIDATES]
        + [(f"{c} (Selektions-Fit)", test_metrics_selection_fit[c]) for c in CANDIDATES]
        + [
            ("logreg_no_source_features (Ablation)", ablation_m),
            ("total_score_baseline (echte Spalte)", total_score_m),
            ("legacy_formula_baseline (alte Formel)", legacy_m),
            (f"reranker (test period, n={reranker_test_period['runs_used']})", reranker_test_row),
            (f"reranker (overall, n={reranker_overall.get('runs_measured')})", reranker_overall_row),
            ("random_baseline", random_m),
        ],
    )
    print()
    print_comparison_table(f"GATE-VERGLEICH (R25/R26/8c, apples-to-apples, n={gate_comparison['runs_used']} Laeufe):", [
        (f"model ({winner})", gate_comparison["model"]),
        ("reranker (suggested_ids)", gate_comparison["reranker"]),
        ("total_score (echte Spalte)", gate_comparison["total_score"]),
        ("random (erwartet, gleicher Pool)", gate_comparison["random"]),
    ] + [(f"  Kandidat {mark(c)}", gate_comparison[c]) for c in CANDIDATES])
    print()
    print("Top-Gewichte (LR refit, standardisierte Koeffizienten — NICHT die entstandardisierten Export-Gewichte):")
    for name, w in report["top_weights_standardized"]:
        print(f"  {name:<28}{w:+.4f}")
    print()
    print(json.dumps({k: report[k] for k in ("winner", "winner_reason", "parity")}, indent=1))


if __name__ == "__main__":
    main()
