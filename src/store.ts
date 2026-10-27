import { Database } from "bun:sqlite"
import { mkdirSync } from "fs"
import { dirname } from "path"
import { chunk } from "./chunk"
import { config } from "./config"
import { embed, embedQuery } from "./embed"
import { rowId } from "./ids"
import type { Memory } from "./capture"

export interface Hit {
  memory_id: string
  title: string
  directory: string
  created_at: number
  status: string
  score: number
  relative: number
  chunk_text: string
}

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export class Store {
  private db: Database

  constructor(path = config.db) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS chunks (
        memory_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL, title TEXT NOT NULL, directory TEXT NOT NULL,
        created_at INTEGER NOT NULL, status TEXT NOT NULL, compaction_reason TEXT NOT NULL,
        full_text TEXT NOT NULL, vector BLOB NOT NULL,
        PRIMARY KEY (memory_id, chunk_index))`,
    )
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_text, content='', contentless_delete=1)`)
  }

  close() {
    this.db.close()
  }

  lastSaved(): number {
    return (this.db.query("SELECT MAX(created_at) m FROM chunks").get() as any)?.m ?? 0
  }

  async save(memory: Memory) {
    const chunks = chunk(memory.full_text)
    const vectors = await embed(chunks)
    this.ensureDims(vectors[0].length)
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO chunks
       (memory_id, chunk_index, chunk_text, title, directory, created_at, status, compaction_reason, full_text, vector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.db.transaction(() => {
      const old = this.db
        .query("SELECT chunk_index, chunk_text FROM chunks WHERE memory_id = ?")
        .all(memory.memory_id) as any[]
      old.forEach((r) => this.db.query("DELETE FROM chunks_fts WHERE rowid = ?").run(rowId(memory.memory_id, r.chunk_index)))
      this.db.query("DELETE FROM chunks WHERE memory_id = ?").run(memory.memory_id)
      chunks.forEach((chunk_text, i) => {
        this.db.query("INSERT INTO chunks_fts(rowid, chunk_text) VALUES (?, ?)").run(rowId(memory.memory_id, i), chunk_text)
        insert.run(
          memory.memory_id, i, chunk_text, memory.title, memory.directory, memory.created_at,
          memory.status, memory.compaction_reason, memory.full_text,
          Buffer.from(new Float32Array(vectors[i]).buffer),
        )
      })
    })()
  }

  exists(memory_id: string) {
    return !!this.db.query("SELECT 1 FROM chunks WHERE memory_id = ? LIMIT 1").get(memory_id)
  }

  isSystem(memory_id: string) {
    return (this.db.query("SELECT status = 'system_compact' s FROM chunks WHERE memory_id = ? LIMIT 1").get(memory_id) as any)?.s === 1
  }

  async search(query: string, limit: number, includeHistory = false): Promise<Hit[]> {
    const q = new Float32Array(await embedQuery(query))
    const rows = this.db
      .query(
        `SELECT memory_id, title, directory, created_at, status, chunk_text, vector FROM chunks${
          includeHistory ? "" : " WHERE status NOT IN ('superseded', 'dropped')"
        }`,
      )
      .all() as any[]
    const groups = new Map<string, { row: any; scores: number[] }>()
    for (const row of rows) {
      const score = cosine(q, new Float32Array(row.vector.buffer))
      const g = groups.get(row.memory_id) ?? { row, scores: [] }
      g.scores.push(score)
      groups.set(row.memory_id, g)
    }
    const sem = [...groups.values()]
      .map((g) => {
        g.scores.sort((a, b) => b - a)
        const top = g.scores.slice(0, 2)
        return { ...g, raw: top.reduce((a, b) => a + b) / top.length }
      })
      .filter((g) => g.raw >= config.minScore)
      .sort((a, b) => b.raw - a.raw)
    const rrf = new Map<string, { row: any; raw: number; score: number }>()
    for (const [rank, g] of sem.entries()) rrf.set(g.row.memory_id, { row: g.row, raw: g.raw, score: 1 / (60 + rank + 1) })
    for (const [rank, row] of this.keyword(query).entries()) {
      const g = groups.get(row.memory_id)
      if (!g) continue
      const e = rrf.get(row.memory_id) ?? { row: g.row, raw: 0, score: 0 }
      e.score += 1 / (60 + rank + 1)
      rrf.set(row.memory_id, e)
    }
    const scored = [...rrf.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    const topScore = scored[0]?.score ?? 1
    return scored.map((g) => ({
      memory_id: g.row.memory_id, title: g.row.title, directory: g.row.directory,
      created_at: g.row.created_at, status: g.row.status,
      score: +(g.raw - config.baseline).toFixed(3),
      relative: +(g.score / topScore).toFixed(2), chunk_text: g.row.chunk_text,
    }))
  }

  private keyword(query: string): any[] {
    const terms = query.match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu)?.slice(0, 8).map((t) => `"${t}"`)
    if (!terms?.length) return []
    try {
      const ids = this.db
        .query(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 20`)
        .all(terms.join(" OR ")) as any[]
      if (!ids.length) return []
      const wanted = ids.map((i) => Number(i.rowid))
      const byId = new Map(
        (this.db.query("SELECT * FROM chunks").all() as any[]).map((r) => [Number(rowId(r.memory_id, r.chunk_index)), r]),
      )
      return wanted.map((id) => byId.get(id)).filter(Boolean)
    } catch {
      return []
    }
  }

  inventory() {
    const rows = this.db
      .query("SELECT DISTINCT memory_id, status FROM chunks")
      .all() as any[]
    const sources = ["opencode", "claude", "manual"]
    const statuses = ["system_compact", "idea", "plan", "active", "dropped", "superseded"]
    const table: Record<string, Record<string, number | null>> = {}
    for (const s of sources) {
      table[s] = {}
      for (const st of statuses) table[s][st] = null
    }
    for (const r of rows) {
      const src = r.memory_id.startsWith("ses_") ? "opencode" : r.memory_id.startsWith("claude-") ? "claude" : "manual"
      if (table[src][r.status] === null) table[src][r.status] = 0
      table[src][r.status]!++
    }
    return { table, total: rows.length }
  }

  async get(memoryID: string): Promise<Memory | undefined> {
    return (this.db
      .query("SELECT memory_id, title, directory, created_at, status, compaction_reason, full_text FROM chunks WHERE memory_id = ? LIMIT 1")
      .get(memoryID) as Memory | undefined) ?? undefined
  }

  private ensureDims(dims: number) {
    const stored = this.db.query("SELECT value FROM meta WHERE key = 'dims'").get() as { value: string } | undefined
    if (stored) {
      if (Number(stored.value) !== dims)
        throw new Error(`database has ${stored.value} dims, model "${config.model}" produces ${dims}`)
    } else {
      this.db.query("INSERT INTO meta (key, value) VALUES ('dims', ?)").run(String(dims))
    }
  }
}
