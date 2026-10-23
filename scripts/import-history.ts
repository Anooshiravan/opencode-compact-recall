import { Database } from "bun:sqlite"
import { existsSync, globSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { Store } from "../src/store"
import type { Memory } from "../src/capture"

const store = new Store()
let done = 0

const put = async (m: Memory) => {
  if (store.exists(m.memory_id) || store.isSystem(m.memory_id)) return
  await store.save(m)
  done++
  console.log(`imported ${m.memory_id} (${m.full_text.length} chars)`)
}

const dbPath = join(homedir(), ".local/share/opencode/opencode.db")
if (process.argv[2] !== "--claude-only" && existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true })
  const rows = db.query(
    `SELECT m.session_id, m.data, s.title, s.directory FROM session_message m
     JOIN session_v2 s ON s.id = m.session_id
     WHERE m.type = 'compaction' AND m.seq = (
       SELECT MAX(seq) FROM session_message WHERE type = 'compaction' AND session_id = m.session_id)`,
  ).all() as any[]
  for (const r of rows) {
    const d = JSON.parse(r.data)
    if (d.status !== "completed" || !d.summary?.trim()) continue
    await put({
      memory_id: r.session_id,
      title: r.title ?? "",
      directory: r.directory ?? "",
      created_at: d.time?.created ?? Date.now(),
      status: "system_compact",
      compaction_reason: d.reason ?? "",
      full_text: d.summary,
    })
  }
  console.log(`opencode: ${rows.length} sessions with compaction`)
}

if (process.argv[2] !== "--opencode-only") {
  for (const file of globSync(join(homedir(), ".claude/projects/*/*.jsonl"))) {
    let last = ""
    let at = 0
    let dir = ""
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"isCompactSummary":true')) continue
      try {
        const j = JSON.parse(line)
        const content = j.message?.content
        const text = typeof content === "string" ? content : ""
        if (text) { last = text; at = Date.parse(j.timestamp) || Date.now() }
        if (j.cwd) dir = j.cwd
      } catch {}
    }
    if (!last) continue
    const id = file.split("/").pop()!.replace(".jsonl", "")
    await put({
      memory_id: `claude-${id}`,
      title: "",
      directory: dir || file.split("/").slice(-2, -1)[0].replace(/^-/, "/").replace(/-/g, "/"),
      created_at: at,
      status: "system_compact",
      compaction_reason: "auto",
      full_text: last,
    })
  }
  console.log("claude: done")
}

console.log(`imported ${done} memories`)
