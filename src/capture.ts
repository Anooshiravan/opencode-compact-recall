export interface Memory {
  memory_id: string
  title: string
  directory: string
  created_at: number
  status: string
  compaction_reason: string
  full_text: string
}

export function findSummary(messages: readonly any[]): any | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type === "compaction" && m.status === "completed" && m.summary?.trim()) return m
  }
}

const STATUSES = ["idea", "plan", "active", "dropped", "superseded"]

export function parseNote(text: string): { status: string; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { status: "idea", body: text }
  const status = /status:\s*(\w+)/.exec(m[1])?.[1]
  return { status: STATUSES.includes(status ?? "") ? status! : "idea", body: text.slice(m[0].length) }
}
