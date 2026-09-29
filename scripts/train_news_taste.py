# /// script
# requires-python = ">=3.11"
# dependencies = ["scikit-learn>=1.4", "lightgbm>=4.3", "numpy>=1.26"]
# ///
"""News-Taste-Training: LR vs. LightGBM auf dem Jev-Feature-Dataset.

Temporaler Split (aelteste 80% der Tage = Training, juengste 20% = Test),
Bewertung PRO TAG als Ranking (Recall@10/15, NDCG@15 — Formeln identisch zu
lib/news-queue/metrics.ts). Gewinner nach NDCG@15; bei < 0.01 Differenz
gewinnt die logistische Regression (einfacheres Artefakt).

Zusaetzlich zum Brief:
- Abbruch, wenn das Dataset eine andere features_version traegt als
  FEATURES_VERSION.
- Parity-Check (mandatory) fuer BEIDE Modelle: die exportierten Parameter
  muessen predict_proba() bis auf 1e-6 exakt reproduzieren (LR: Skalarprodukt
  + Sigmoid; LightGBM: Baum-Walk ueber tree_structure + Sigmoid). Nach dem
  Schreiben des Artefakts wird es zusaetzlich vom Datentraeger neu geladen
  und fuer das Gewinnermodell erneut geprueft.
- Reranker-Baseline zusaetzlich auf den Testtagen (nicht nur gesamt).
- Random-Baseline (erwarteter Recall/NDCG einer zufaelligen Reihenfolge) als
  Referenz-Boden.

Lauf: npm run taste:train   (uv run scripts/train_news_taste.py)
"""
import datetime
import json
import math
import sys
from pathlib import Path

import numpy as np
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "taste-dataset.json"
BASELINE = ROOT / "reranker-baseline.json"
ARTIFACT = ROOT.parent / "lib" / "news-taste" / "model.json"
REPORT = ROOT / "taste-train-report.json"
FEATURES_VERSION = 1  # muss lib/news-taste/questions.ts entsprechen

SEED = 0
PARITY_SAMPLE_SIZE = 50
PARITY_TOLERANCE = 1e-6


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for i in ranked[:k] if i in relevant) / len(relevant)


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, x in enumerate(ranked[:k]) if x in relevant)
    ideal = min(len(relevant), k)
    idcg = sum(1 / math.log2(i + 2) for i in range(ideal))
    return dcg / idcg if idcg else 0.0


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
    pro Tag exakt berechnet (Linearitaet des Erwartungswerts), dann ueber Tage
    gemittelt wie bei den echten Modellen. Dient als Referenz-Boden."""
    r10, r15, ndcg = [], [], []
    for d in days:
        n = len(d["items"])
        r = sum(1 for it in d["items"] if it["label"])
        if r == 0 or n == 0:
            r10.append(0.0)
            r15.append(0.0)
            ndcg.append(0.0)
            continue
        r10.append(min(10, n) / n)
        r15.append(min(15, n) / n)
        k = 15
        kk = min(k, n)
        disc = [1 / math.log2(i + 2) for i in range(kk)]
        e_dcg = (r / n) * sum(disc)
        ideal_hits = min(r, k)
        idcg = sum(1 / math.log2(i + 2) for i in range(ideal_hits))
        ndcg.append(e_dcg / idcg if idcg else 0.0)
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
    while "leaf_value" not in node:
        assert node["decision_type"] == "<=", f"unerwarteter decision_type: {node['decision_type']}"
        f = node["split_feature"]
        if x[f] <= node["threshold"]:
            node = node["left_child"]
        else:
            node = node["right_child"]
    return node["leaf_value"]


def lgbm_predict_from_trees(trees: list[dict], X: np.ndarray) -> np.ndarray:
    margins = np.array([sum(_walk_lgbm_tree(t, x) for t in trees) for x in X], dtype=float)
    return sigmoid(margins)


def print_comparison_table(rows: list[tuple[str, dict | None]]) -> None:
    header = f"{'model':<28}{'R@10':>8}{'R@15':>8}{'NDCG@15':>10}"
    print(header)
    print("-" * len(header))
    for name, m in rows:
        if m is None:
            print(f"{name:<28}{'n/a':>8}{'n/a':>8}{'n/a':>10}")
            continue
        print(f"{name:<28}{m['recall_at_10']:>8.4f}{m['recall_at_15']:>8.4f}{m['ndcg_at_15']:>10.4f}")


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

    names, days = data["feature_names"], data["days"]
    days.sort(key=lambda d: d["day"])
    cut = int(len(days) * 0.8)
    train_days, test_days = days[:cut], days[cut:]
    X = np.array([it["x"] for d in train_days for it in d["items"]], dtype=float)
    y = np.array([1 if it["label"] else 0 for d in train_days for it in d["items"]])
    print(
        f"Train: {len(train_days)} Tage / {len(X)} Items ({y.sum()} pos) — "
        f"Test: {len(test_days)} Tage ({test_days[0]['day']}..{test_days[-1]['day']})"
    )

    # Logistische Regression auf standardisierten Features. class_weight
    # balanced: ~2-5% Positive, sonst lernt sie nur die Mehrheitsklasse.
    means, stds = X.mean(axis=0), X.std(axis=0)
    stds[stds == 0] = 1.0
    lr = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced", random_state=SEED)
    lr.fit((X - means) / stds, y)

    lgbm = LGBMClassifier(
        n_estimators=300, learning_rate=0.05, num_leaves=31,
        min_child_samples=20, class_weight="balanced", random_state=SEED, verbose=-1,
    )
    lgbm.fit(X, y)

    lr_m = rank_days(test_days, lambda A: lr.decision_function((A - means) / stds))
    gb_m = rank_days(test_days, lambda A: lgbm.predict_proba(A)[:, 1])
    # Baseline: die alte total_score-Formel aus den Extra-Features rekonstruiert.
    i_syn, i_rel, i_unq = names.index("synthesis_score"), names.index("relevance_score"), names.index("uniqueness_score")
    i_bon = names.index("source_bonus")
    base_m = rank_days(test_days, lambda A: 0.4 * A[:, i_syn] + 0.3 * A[:, i_rel] + 0.3 * A[:, i_unq] + A[:, i_bon])
    random_m = expected_random_metrics(test_days)

    winner = "logreg" if lr_m["ndcg_at_15"] >= gb_m["ndcg_at_15"] - 0.01 else "lightgbm"
    metrics = lr_m if winner == "logreg" else gb_m

    # --- Export-Parameter fuer BEIDE Modelle bauen (Parity-Check gilt fuer beide) ---
    lr_weights = [float(w / s) for w, s in zip(lr.coef_[0], stds)]  # entstandardisiert …
    lr_bias = float(lr.intercept_[0] - float(np.dot(lr.coef_[0], means / stds)))  # … Bias angepasst

    dump = lgbm.booster_.dump_model()
    lgbm_trees = [t["tree_structure"] for t in dump["tree_info"]]

    # --- Parity-Check (mandatory, beide Modelle, ~50 Testzeilen, Original-x) ---
    rng = np.random.RandomState(SEED)
    test_X = np.array([it["x"] for d in test_days for it in d["items"]], dtype=float)
    n_sample = min(PARITY_SAMPLE_SIZE, len(test_X))
    sample_idx = rng.choice(len(test_X), n_sample, replace=False)
    sample_X = test_X[sample_idx]

    manual_lr = lr_predict_from_export(lr_weights, lr_bias, sample_X)
    ref_lr = lr.predict_proba((sample_X - means) / stds)[:, 1]
    diff_lr = float(np.max(np.abs(manual_lr - ref_lr)))

    manual_gb = lgbm_predict_from_trees(lgbm_trees, sample_X)
    ref_gb = lgbm.predict_proba(sample_X)[:, 1]
    diff_gb = float(np.max(np.abs(manual_gb - ref_gb)))

    print(f"Parity (in-memory export params, n={n_sample}): LR max diff={diff_lr:.3e}  LightGBM max diff={diff_gb:.3e}")

    if diff_lr > PARITY_TOLERANCE or diff_gb > PARITY_TOLERANCE:
        print(
            f"ERROR: Parity-Check fehlgeschlagen (Toleranz {PARITY_TOLERANCE:.0e}). "
            f"LR diff={diff_lr:.3e}, LightGBM diff={diff_gb:.3e}. Abbruch.",
            file=sys.stderr,
        )
        sys.exit(1)

    artifact = {
        "features_version": FEATURES_VERSION,
        "model_type": winner,
        "feature_names": names,
        "trained_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "train_days": len(train_days), "test_days": len(test_days),
        "metrics": metrics,
        "logreg": None, "lightgbm": None,
    }
    if winner == "logreg":
        artifact["logreg"] = {
            "weights": lr_weights,
            "bias": lr_bias,
            "means": [0.0] * len(names), "stds": [1.0] * len(names),  # TS rechnet dann roh
        }
    else:
        artifact["lightgbm"] = {"trees": lgbm_trees}

    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.write_text(json.dumps(artifact))

    # --- Parity-Check nach dem Schreiben: Artefakt vom Datentraeger neu laden ---
    reloaded = json.loads(ARTIFACT.read_text())
    if reloaded["model_type"] == "logreg":
        w = np.array(reloaded["logreg"]["weights"], dtype=float)
        b = reloaded["logreg"]["bias"]
        manual_reloaded = sigmoid(b + sample_X @ w)
        ref_reloaded = lr.predict_proba((sample_X - means) / stds)[:, 1]
    else:
        trees_reloaded = reloaded["lightgbm"]["trees"]
        manual_reloaded = lgbm_predict_from_trees(trees_reloaded, sample_X)
        ref_reloaded = lgbm.predict_proba(sample_X)[:, 1]
    diff_reloaded = float(np.max(np.abs(manual_reloaded - ref_reloaded)))
    print(f"Parity (reloaded artifact, winner={winner}): max diff={diff_reloaded:.3e}")
    if diff_reloaded > PARITY_TOLERANCE:
        print(
            f"ERROR: Parity-Check nach Reload fehlgeschlagen (Toleranz {PARITY_TOLERANCE:.0e}). "
            f"diff={diff_reloaded:.3e}. Abbruch.",
            file=sys.stderr,
        )
        sys.exit(1)

    # --- Reranker-Baseline: gesamt + auf dem Testzeitraum ---
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
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

    report = {
        "winner": winner,
        "logreg": lr_m,
        "lightgbm": gb_m,
        "total_score_baseline": base_m,
        "random_baseline": random_m,
        "reranker_baseline_overall": reranker_overall,
        "reranker_baseline_test_period": reranker_test_period,
        "parity": {
            "sample_size": n_sample,
            "logreg_max_diff": diff_lr,
            "lightgbm_max_diff": diff_gb,
            "winner_reloaded_max_diff": diff_reloaded,
        },
        "top_weights": sorted(zip(names, [float(w) for w in lr.coef_[0]]), key=lambda t: -abs(t[1]))[:12],
    }
    REPORT.write_text(json.dumps(report, indent=1))

    print()
    print(f"Gewinner: {winner}  (Test-Reranker-Baseline-Vergleich unten massgeblich)")
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
    print_comparison_table([
        ("logreg", lr_m),
        ("lightgbm", gb_m),
        ("total_score_baseline", base_m),
        (f"reranker (test period, n={reranker_test_period['runs_used']})", reranker_test_row),
        (f"reranker (overall, n={reranker_overall.get('runs_measured')})", reranker_overall_row),
        ("random_baseline", random_m),
    ])
    print()
    print(json.dumps(report, indent=1)[:2000])


if __name__ == "__main__":
    main()
