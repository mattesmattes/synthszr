# Synthszr Charts — What the Ranking Does

**In short:** Synthszr Charts is an automatically maintained ranking of the AI **products** that
matter most right now — think of it like a charts/bestseller list, except "sales" are replaced
by media attention.

## What gets ranked

AI **products**, not companies — and version-specific (GPT-5.6 ≠ GPT-5.5, Claude Opus 4.8 ≠
Fable 5). So you can see which exact version has momentum right now, not just "something from
OpenAI."

## Where the data comes from

Thousands of newsletters and news sources, ingested daily. An AI pipeline detects the AI
products mentioned in them, assigns each to one of ~50 categories (e.g. Frontier LLMs, Coding
Agents, Text-to-Video), and counts the mentions.

## How the rank is calculated

The **Momentum score** is the sum of mentions, recency-weighted: fresh mentions count fully,
older ones decay with a 14-day half-life. So a product rises when it's being talked about a lot
— and falls when it goes quiet. The rank is **category-relative**: "#1 in Coding Agents" means
top of that category.

## What you see on the pages

- **Overview** (`/rankings`): leaderboard with rank, momentum sparkline and score, filterable by
  category.
- **Product page**: short description, release date, researched feature specs (each backed by a
  source — no guessing), sentiment, 90-day momentum history, and the original evidence (which
  news mentioned the product).
- **Compare**: several products side by side as a feature matrix.

## Key properties

- **Fully automatic & daily** — no manual curation; a cron job refreshes data and ranks.
- **Multilingual** — DE plus EN/FR/CS/Low German; feature specs appear in English on all
  non-German locales.
- **Citation-required** — researched values always carry a source.
- **Version-granular** — each product version is tracked separately, so trends aren't blurred
  across releases.

## What it's for

A fast, data-driven view of which AI products are gaining traction right now — a trend radar and
a research starting point, with specs and sources in one place.
