-- Remove the experimental embedding-taste model objects.
-- Empirically, article embeddings did not encode within-day pickability
-- (centroid/kNN/LR all scored at or below baseline). Dropping the unused objects.
DROP FUNCTION IF EXISTS taste_lr_score(uuid[]);
DROP FUNCTION IF EXISTS taste_knn_score(uuid[], int);
DROP TABLE IF EXISTS taste_model;
DROP TABLE IF EXISTS taste_labels;
