# opencode-compact-recall

> **Agents:** for agentic installation, follow [AGENTS.md](AGENTS.md).

Saves every compaction summary and lets the agent search them semantically.

Only the compaction summary text is stored. No user messages, no chat
text, no system prompts are ever saved.

## Design

- **Privacy first** — only the compaction summary is stored; chat,
  prompts and transcripts never touch the database.
- **Zero services** — `bun:sqlite` + local embeddings. No vector DB,
  no API keys, works offline.
- **Hints, not transcripts** — one summary per session, latest wins.
  The goal is to remind the agent *what* to go read, not replay it.
- **Hybrid retrieval** — embeddings blur exact identifiers, so every
  query runs semantic + keyword with reciprocal-rank fusion.

This is the best way to give opencode memory because it builds on what
opencode already does: compaction is opencode's own summarization, so
the plugin adds memory with zero extra tokens spent on note-taking,
zero background jobs, and nothing to maintain. Every other "agent
memory" approach makes the agent write and maintain memories — paying
tokens and attention for it. Here the memory is a free by-product of a
mechanism that was running anyway, stored locally, private by design,
and searchable in one round-trip.

## Setup

Add the plugin to `opencode.json`:

```json
{ "plugin": ["opencode-compact-recall"] }
```

Summaries are embedded locally (CPU) with `Xenova/bge-small-en-v1.5` and
stored in a SQLite database. No server, no API keys.

## Tools

- `compact_recall_search` — hybrid semantic + keyword search over all
  memories. Args: `query`, `limit` (5). Returns `score` (calibrated) and
  `relative` (vs top hit) per hit, plus its `status`.
- `compact_recall_save` — create a note (idea/plan). Fails if the title
  exists; notes are never deleted.
- `compact_recall_update` — replace a note's full text/status by
  `memory_id`. Retire with `status: dropped` or `superseded`.
- `compact_recall_get` — full text by `memory_id`.
- `compact_recall_inventory` — counts by source and status.

## Config

| Variable                     | Default                                |
|------------------------------|----------------------------------------|
| `COMPACT_RECALL_DB`          | `~/.local/share/opencode/compact-recall.db` |
| `COMPACT_RECALL_MODEL`       | `Xenova/bge-small-en-v1.5`             |
| `COMPACT_RECALL_MIN_SCORE`   | `0.5`                                  |
| `COMPACT_RECALL_BASELINE`    | `0.3` (calibration offset)             |
| `COMPACT_RECALL_LOG`         | `~/.local/share/opencode/compact-recall.log` |
| `COMPACT_RECALL_ENABLED`     | `true`                                 |
