# /// script
# requires-python = ">=3.11"
# dependencies = ["scikit-learn>=1.4", "lightgbm>=4.3", "numpy>=1.26"]
# ///
"""News-Taste-Training: LR vs. LightGBM auf dem Jev-Feature-Dataset.

Temporaler Split (aelteste 80% der (gefilterten) Tage = Training, juengste 20%
= Test), Bewertung PRO TAG als Ranking (Recall@10/15, NDCG@15 — Formeln
identisch zu lib/news-queue/metrics.ts). Gewinner nach NDCG@15; bei < 0.01
Differenz gewinnt die logistische Regression (einfacheres Artefakt).

Zusaetzlich zum Brief:
- Abbruch, wenn das Dataset eine andere features_version traegt als
  FEATURES_VERSION.
- Parity-Check (mandatory) fuer BEIDE Modelle: die exportierten Parameter
  muessen predict_proba() bis auf 1e-6 exakt reproduzieren (LR: Skalarprodukt
  + Sigmoid; LightGBM: Baum-Walk ueber tree_structure + Sigmoid). Nach dem
  Schreiben des Artefakts wird es zusaetzlich vom Datentraeger neu geladen
  und fuer das Gewinnermodell erneut geprueft. Artefakt wird atomar
  geschrieben (Temp-Datei + Rename), erst NACH bestandenem Reload-Parity-Check.
- Reranker-Baseline zusaetzlich auf den Testtagen (nicht nur gesamt).
- Random-Baseline (erwarteter Recall/NDCG einer zufaelligen Reihenfolge) als
  Referenz-Boden.

Fix Round 1 (Controller-Review):
- R24: source_pub_rate ist vor MIN_DAY (2026-03-29) rueckwirkend aus ALLEN
  jemals veroeffentlichten Posts befuellt worden (Migration
  20260328_optimized_scoring.sql) — das ist ein Label-Leak (das Feature
  "kennt" quasi das eigene Label). Ab MIN_DAY wird es Punkt-in-Zeit berechnet
  (lib/synthesis/pipeline.ts getSourcePubRates). Tage vor MIN_DAY werden VOR
  dem Split verworfen. Zusaetzlich eine Ablation ohne source_pub_rate/
  source_bonus (nur Metriken, nicht exportiert) — zeigt, was Jev ueber den
  reinen Quellen-Prior hinaus beitraegt.
- R25: Gate-Vergleich apples-to-apples. Reranker-Baseline (48h-Fenster) und
  Modell-Metriken (Tages-Ranking) sind bisher nicht direkt vergleichbar. Fuer
  jeden Reranker-Lauf im Testzeitraum wird ein Pool aus den Datensatz-Items
  von Lauftag + Vortag gebildet; relevant = die tatsaechlich binnen 48h
  veroeffentlichten Items, geschnitten mit dem Pool. Modell und Reranker
  ranken denselben Pool, dieselben relevanten Items — das ist die Zahl, die
  das Gate verwendet.
- total_score_baseline rekonstruiert jetzt die PRODUKTIONS-Formel
  (source_pub_rate*17.5 + relevance*0.82 + synthesis*0.31 +
  min(content_length/10000,1)*0.31, s. Migration 20260328_optimized_scoring.sql
  Zeile 25-30); die alte Formel (0.4*syn + 0.3*rel + 0.3*unq + source_bonus)
  bleibt als legacy_formula_baseline zum Vergleich erhalten.

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

# R24: source_pub_rate ist vor diesem Datum rueckwirkend aus dem gesamten
# (auch zukuenftigen) Post-Bestand befuellt worden — Label-Leak. Ab hier ist
# es Punkt-in-Zeit (lib/synthesis/pipeline.ts getSourcePubRates).
MIN_DAY = "2026-03-29"

SEED = 0
PARITY_SAMPLE_SIZE = 50
PARITY_TOLERANCE = 1e-6

ABLATION_EXCLUDED_FEATURES = {"source_pub_rate", "source_bonus"}


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
    # s. Parity-Check unten und Report). Falls ein kuenftiger LightGBM-Lauf
    # doch einen Offset braeuchte, wuerde der Parity-Check das mit einem
    # harten Abbruch anzeigen statt still ein falsches Artefakt zu exportieren.
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


def lgbm_predict_from_trees(trees: list[dict], X: np.ndarray) -> np.ndarray:
    margins = np.array([sum(_walk_lgbm_tree(t, x) for t in trees) for x in X], dtype=float)
    return sigmoid(margins)


def score_pool_ids(pool_items: list[dict], score_fn) -> list[str]:
    ids = [it["id"] for it in pool_items]
    X_pool = np.array([it["x"] for it in pool_items], dtype=float)
    scores = score_fn(X_pool)
    return [ids[i] for i in np.argsort(-scores)]


def compute_gate_comparison(test_days, day_index: dict, per_run: list[dict], winner_score_fn) -> dict:
    """R25: apples-to-apples Gate-Vergleich. Fuer jeden Reranker-Lauf im
    Testzeitraum: Pool = Datensatz-Items von Lauftag + Vortag, relevant =
    binnen 48h veroeffentlichte Items (aus der Baseline-Messung) geschnitten
    mit dem Pool. Modell und Reranker ranken denselben Pool/dieselben
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

        suggested_ids = run.get("suggested_ids") or []
        model_order = score_pool_ids(pool_items, winner_score_fn)
        n_pool, n_rel = len(pool_items), len(relevant)

        rows.append({
            "runId": run.get("runId"), "day": day, "n_pool": n_pool, "n_relevant": n_rel,
            "model": {
                "r10": recall_at_k(model_order, relevant, 10),
                "r15": recall_at_k(model_order, relevant, 15),
                "ndcg15": ndcg_at_k(model_order, relevant, 15),
            },
            "reranker": {
                "r10": recall_at_k(suggested_ids, relevant, 10),
                "r15": recall_at_k(suggested_ids, relevant, 15),
                "ndcg15": ndcg_at_k(suggested_ids, relevant, 15),
            },
            "random": {
                "r10": expected_recall_at_k(n_pool, n_rel, 10),
                "r15": expected_recall_at_k(n_pool, n_rel, 15),
                "ndcg15": expected_ndcg_at_k(n_pool, n_rel, 15),
            },
        })

    if not rows:
        return {"runs_used": 0, "model": None, "reranker": None, "random": None, "rows": []}

    def avg(group: str, metric: str) -> float:
        return float(np.mean([r[group][metric] for r in rows]))

    def summarize(group: str) -> dict:
        return {
            "recall_at_10": avg(group, "r10"),
            "recall_at_15": avg(group, "r15"),
            "ndcg_at_15": avg(group, "ndcg15"),
        }

    return {
        "runs_used": len(rows),
        "model": summarize("model"),
        "reranker": summarize("reranker"),
        "random": summarize("random"),
        "rows": rows,
    }


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
        deterministic=True, force_row_wise=True,
    )
    lgbm.fit(X, y)

    lr_score_fn = lambda A: lr.decision_function((A - means) / stds)
    gb_score_fn = lambda A: lgbm.predict_proba(A)[:, 1]

    lr_m = rank_days(test_days, lr_score_fn)
    gb_m = rank_days(test_days, gb_score_fn)

    # --- Baselines aus den Extra-Features rekonstruiert ---
    i_syn = names.index("synthesis_score")
    i_rel = names.index("relevance_score")
    i_unq = names.index("uniqueness_score")
    i_bon = names.index("source_bonus")
    i_pubrate = names.index("source_pub_rate")
    i_logclen = names.index("log_content_length")

    def total_score_prod(A: np.ndarray) -> np.ndarray:
        # Produktionsformel seit supabase/migrations/20260328_optimized_scoring.sql:25-30
        content_length = 10.0 ** A[:, i_logclen] - 1.0
        length_factor = np.minimum(content_length / 10000.0, 1.0)
        return A[:, i_pubrate] * 17.5 + A[:, i_rel] * 0.82 + A[:, i_syn] * 0.31 + length_factor * 0.31

    def legacy_formula(A: np.ndarray) -> np.ndarray:
        # Alte Formel vor der Migration — nur noch zum Vergleich.
        return 0.4 * A[:, i_syn] + 0.3 * A[:, i_rel] + 0.3 * A[:, i_unq] + A[:, i_bon]

    total_score_m = rank_days(test_days, total_score_prod)
    legacy_m = rank_days(test_days, legacy_formula)
    random_m = expected_random_metrics(test_days)

    # --- R24 Ablation: LR ohne source_pub_rate/source_bonus (nur Metriken) ---
    keep_idx = [i for i, n in enumerate(names) if n not in ABLATION_EXCLUDED_FEATURES]
    X_ab = X[:, keep_idx]
    means_ab, stds_ab = X_ab.mean(axis=0), X_ab.std(axis=0)
    stds_ab[stds_ab == 0] = 1.0
    lr_ablation = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced", random_state=SEED)
    lr_ablation.fit((X_ab - means_ab) / stds_ab, y)
    ablation_score_fn = lambda A: lr_ablation.decision_function((A[:, keep_idx] - means_ab) / stds_ab)
    ablation_m = rank_days(test_days, ablation_score_fn)
    print(
        f"Ablation logreg_no_source_features (ohne {sorted(ABLATION_EXCLUDED_FEATURES)}): "
        f"R@15={ablation_m['recall_at_15']:.4f} NDCG@15={ablation_m['ndcg_at_15']:.4f} "
        f"(volles LR: R@15={lr_m['recall_at_15']:.4f} NDCG@15={lr_m['ndcg_at_15']:.4f})"
    )

    winner = "logreg" if lr_m["ndcg_at_15"] >= gb_m["ndcg_at_15"] - 0.01 else "lightgbm"
    metrics = lr_m if winner == "logreg" else gb_m
    winner_score_fn = lr_score_fn if winner == "logreg" else gb_score_fn

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

    # NaN-sicher: "not (diff <= tol)" faengt auch diff=NaN ab (NaN > tol waere False).
    if not (diff_lr <= PARITY_TOLERANCE) or not (diff_gb <= PARITY_TOLERANCE):
        print(
            f"ERROR: Parity-Check fehlgeschlagen (Toleranz {PARITY_TOLERANCE:.0e}). "
            f"LR diff={diff_lr}, LightGBM diff={diff_gb}. Abbruch.",
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

    # --- Atomar schreiben: erst Temp-Datei, Parity-Check auf dem Reload, dann Rename ---
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = ARTIFACT.with_suffix(ARTIFACT.suffix + ".tmp")
    tmp_path.write_text(json.dumps(artifact, allow_nan=False))

    reloaded = json.loads(tmp_path.read_text())
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
    if not (diff_reloaded <= PARITY_TOLERANCE):
        tmp_path.unlink(missing_ok=True)
        print(
            f"ERROR: Parity-Check nach Reload fehlgeschlagen (Toleranz {PARITY_TOLERANCE:.0e}). "
            f"diff={diff_reloaded}. Abbruch, Temp-Datei geloescht.",
            file=sys.stderr,
        )
        sys.exit(1)

    tmp_path.replace(ARTIFACT)  # atomarer Rename, erst jetzt existiert das Artefakt final
    print(f"Artefakt geschrieben: {ARTIFACT}")

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

    # --- R25: Gate-Vergleich apples-to-apples (Pool = Lauftag + Vortag, gleiche relevante Items) ---
    gate_comparison = compute_gate_comparison(test_days, day_index, per_run, winner_score_fn)

    report = {
        "winner": winner,
        "min_day": MIN_DAY,
        "days_total_before_min_day_filter": len(days_all),
        "days_dropped_before_min_day": len(days_dropped),
        "days_kept_after_min_day_filter": len(days),
        "logreg": lr_m,
        "lightgbm": gb_m,
        "logreg_no_source_features": ablation_m,
        "total_score_baseline": total_score_m,
        "legacy_formula_baseline": legacy_m,
        "random_baseline": random_m,
        "reranker_baseline_overall": reranker_overall,
        "reranker_baseline_test_period": reranker_test_period,
        "gate_comparison": gate_comparison,
        "parity": {
            "sample_size": n_sample,
            "logreg_max_diff": diff_lr,
            "lightgbm_max_diff": diff_gb,
            "winner_reloaded_max_diff": diff_reloaded,
        },
        "top_weights_standardized": sorted(zip(names, [float(w) for w in lr.coef_[0]]), key=lambda t: -abs(t[1]))[:12],
    }
    REPORT.write_text(json.dumps(report, indent=1, allow_nan=False))

    print()
    print(f"Gewinner: {winner}  (Gate-Vergleich unten massgeblich, R25)")
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
    print_comparison_table("Vergleichstabelle (Testtage als Tages-Ranking):", [
        ("logreg", lr_m),
        ("lightgbm", gb_m),
        ("logreg_no_source_features (Ablation)", ablation_m),
        ("total_score_baseline (Produktionsformel)", total_score_m),
        ("legacy_formula_baseline (alte Formel)", legacy_m),
        (f"reranker (test period, n={reranker_test_period['runs_used']})", reranker_test_row),
        (f"reranker (overall, n={reranker_overall.get('runs_measured')})", reranker_overall_row),
        ("random_baseline", random_m),
    ])
    print()
    print_comparison_table(f"GATE-VERGLEICH (R25, apples-to-apples, n={gate_comparison['runs_used']} Laeufe):", [
        (f"model ({winner})", gate_comparison["model"]),
        ("reranker (suggested_ids)", gate_comparison["reranker"]),
        ("random (erwartet, gleicher Pool)", gate_comparison["random"]),
    ])
    print()
    print("Top-Gewichte (LR, standardisierte Koeffizienten — NICHT die entstandardisierten Export-Gewichte):")
    for name, w in report["top_weights_standardized"]:
        print(f"  {name:<28}{w:+.4f}")
    print()
    print(json.dumps(report, indent=1)[:2000])


if __name__ == "__main__":
    main()
