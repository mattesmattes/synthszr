-- Deleting a generated_post failed once an article_job referenced it:
-- "violates foreign key constraint article_jobs_generated_post_id_fkey".
-- The FK was created without an ON DELETE rule (default RESTRICT). Switch it to
-- SET NULL so a post can be deleted; the (historical) job row stays, just loses
-- its post reference.
ALTER TABLE article_jobs DROP CONSTRAINT IF EXISTS article_jobs_generated_post_id_fkey;
ALTER TABLE article_jobs
  ADD CONSTRAINT article_jobs_generated_post_id_fkey
  FOREIGN KEY (generated_post_id) REFERENCES generated_posts(id) ON DELETE SET NULL;
