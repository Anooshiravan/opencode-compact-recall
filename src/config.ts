export const config = {
  db: process.env.COMPACT_RECALL_DB ?? `${process.env.HOME}/.local/share/opencode/compact-recall.db`,
  model: process.env.COMPACT_RECALL_MODEL ?? "Xenova/bge-small-en-v1.5",
  minScore: Number(process.env.COMPACT_RECALL_MIN_SCORE ?? 0.5),
  baseline: Number(process.env.COMPACT_RECALL_BASELINE ?? 0.3),
  enabled: (process.env.COMPACT_RECALL_ENABLED ?? "true") !== "false",
  log: process.env.COMPACT_RECALL_LOG ?? `${process.env.HOME}/.local/share/opencode/compact-recall.log`,
}
