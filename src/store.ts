import { Database } from "bun:sqlite"
import { mkdirSync } from "fs"
import { dirname } from "path"
import { chunk } from "./chunk"
import { config } from "./config"
import { embed, embedQuery } from "./embed"
import { rowId } from "./ids"
import type { Summary } from "./capture"

export interface Hit {
  summary_id: string
  title: string
  directory: string
  created_at: number
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
        id INTEGER PRIMARY KEY, summary_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
        title TEXT NOT NULL, project TEXT NOT NULL, directory TEXT NOT NULL,
        created_at INTEGER NOT NULL, reason TEXT NOT NULL, text TEXT NOT NULL,
        vector BLOB NOT NULL)`,
    )
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_text, content='chunks', content_rowid='id')`)
  }

  async save(summary: Summary) {
    const chunks = chunk(summary.text)
    const vectors = await embed(chunks)
    this.ensureDims(vectors[0].length)
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO chunks
       (id, summary_id, chunk_index, chunk_text, session_id, message_id, title, project, directory, created_at, reason, text, vector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.db.transaction(() => {
      this.db.query("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE session_id = ?)").run(summary.session_id)
      this.db.query("DELETE FROM chunks WHERE session_id = ?").run(summary.session_id)
      chunks.forEach((chunk_text, i) => {
        this.db.query("INSERT INTO chunks_fts (rowid, chunk_text) VALUES (?, ?)").run(rowId(summary.summary_id, i), chunk_text)
        insert.run(
          rowId(summary.summary_id, i), summary.summary_id, i, chunk_text, summary.session_id, summary.message_id,
          summary.title, summary.project, summary.directory, summary.created_at, summary.reason, summary.text,
          Buffer.from(new Float32Array(vectors[i]).buffer),
        )
      })
    })()
  }

  async search(query: string, limit: number, project?: string): Promise<Hit[]> {
    const q = new Float32Array(await embedQuery(query))
    const where = project ? "WHERE project = ?" : ""
    const rows = this.db
      .query(`SELECT summary_id, title, directory, created_at, chunk_text, vector FROM chunks ${where}`)
      .all(...(project ? [project] : [])) as any[]
    const groups = new Map<string, { row: any; scores: number[] }>()
    for (const row of rows) {
      const score = cosine(q, new Float32Array(row.vector.buffer))
      const g = groups.get(row.summary_id) ?? { row, scores: [] }
      g.scores.push(score)
      groups.set(row.summary_id, g)
    }
    const sem = [...groups.values()]
      .map((g) => {
        g.scores.sort((a, b) => b - a)
        const top = g.scores.slice(0, 2)
        return { ...g, raw: top.reduce((a, b) => a + b) / top.length }
      })
      .filter((g) => g.raw >= config.minScore)
      .sort((a, b) => b.raw - a.raw)
    const kw = this.keyword(query, project)
    const rrf = new Map<string, { row: any; raw: number; score: number }>()
    for (const [rank, g] of sem.entries()) {
      const e = rrf.get(g.row.summary_id) ?? { row: g.row, raw: g.raw, score: 0 }
      e.score += 1 / (60 + rank + 1)
      rrf.set(g.row.summary_id, e)
    }
    for (const [rank, row] of kw.entries()) {
      const g = groups.get(row.summary_id)
      if (!g) continue
      const e = rrf.get(row.summary_id) ?? { row: g.row, raw: 0, score: 0 }
      e.score += 1 / (60 + rank + 1)
      rrf.set(row.summary_id, e)
    }
    const scored = [...rrf.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    const topScore = scored[0]?.score ?? 1
    return scored.map((g) => ({
      summary_id: g.row.summary_id, title: g.row.title, directory: g.row.directory,
      created_at: g.row.created_at, score: +(g.raw - config.baseline).toFixed(3),
      relative: +(g.score / topScore).toFixed(2), chunk_text: g.row.chunk_text,
    }))
  }

  private keyword(query: string, project?: string): any[] {
    const terms = query.match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu)?.slice(0, 8).map((t) => `"${t}"`)
    if (!terms?.length) return []
    try {
      return this.db
        .query(
          `SELECT c.summary_id, c.title, c.directory, c.created_at, c.chunk_text
           FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
           WHERE chunks_fts MATCH ? ${project ? "AND c.project = ?" : ""}
           ORDER BY bm25(chunks_fts) LIMIT 20`,
        )
        .all(terms.join(" OR "), ...(project ? [project] : [])) as any[]
    } catch {
      return []
    }
  }

  async get(summaryID: string): Promise<Summary | undefined> {
    return (this.db
      .query(
        `SELECT summary_id, session_id, message_id, title, project, directory, created_at, reason, text
         FROM chunks WHERE summary_id = ? LIMIT 1`,
      )
      .get(summaryID) as Summary | undefined) ?? undefined
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
