export interface Summary {
  summary_id: string
  session_id: string
  message_id: string
  title: string
  project: string
  directory: string
  created_at: number
  reason: string
  text: string
}

export function findSummary(messages: readonly any[]): any | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type === "compaction" && m.status === "completed" && m.summary?.trim()) return m
  }
}
