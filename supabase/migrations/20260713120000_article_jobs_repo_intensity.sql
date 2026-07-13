alter table public.article_jobs
  add column if not exists repo_intensity integer not null default 40;
