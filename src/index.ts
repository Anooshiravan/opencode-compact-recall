import { Plugin } from "@opencode/plugin"
import { config } from "./config"
import { findSummary, parseNote, type Memory } from "./capture"
import { slug } from "./ids"
import { logError } from "./log"
import { Store } from "./store"

const seen = new Set<string>()

const log = (e: unknown) => {
  logError("error", { message: e instanceof Error ? e.message : String(e) })
}

export default Plugin.define({
  id: "compact-recall",
  async setup(ctx) {
    if (!config.enabled) return
    const store = new Store()

    const capture = async (sessionID: string) => {
      try {
        const [session, messages] = await Promise.all([
          ctx.session.get({ sessionID }),
          ctx.session.context({ sessionID }),
        ])
        const message = findSummary(messages)
        if (!message || seen.has(message.id)) return
        seen.add(message.id)
        const memory: Memory = {
          memory_id: sessionID,
          title: "",
          directory: session.location?.directory ?? "",
          created_at: message.time.created,
          status: "system_compact",
          compaction_reason: message.reason ?? "",
          full_text: message.summary,
        }
        try {
          await store.save(memory)
        } catch (e) {
          log(e)
        }
      } catch (e) {
        log(e)
      }
    }

    const abort = new AbortController()
    void (async () => {
      while (!abort.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
            if (event.type === "session.step.ended") await capture((event as any).data.sessionID)
          }
          logError("event stream ended, reconnecting")
        } catch (e) {
          if (abort.signal.aborted) return
          logError("event stream error, reconnecting", { message: e instanceof Error ? e.message : String(e) })
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    })()

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "compact_recall_search",
        description: "Semantically search stored memories: summaries of past (compacted) conversations and saved notes/ideas/plans. Use when asked to recall what was discussed, decided or done in earlier sessions. Results include a status field; treat dropped/superseded as history, not current truth.",
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async ({ query, limit = 5 }) => {
          try {
            const hits = await store.search(query, limit)
            return { content: hits.length ? JSON.stringify(hits, null, 2) : "No matching memories." }
          } catch (e) {
            return { content: `Search failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
      editor.add({
        name: "compact_recall_save",
        description: 'Create a new note as a memory. Fails if a note with the same title exists — use compact_recall_update to change one. Notes are never deleted; to retire one, update it with status: dropped (dead end) or superseded (replaced — say by what and why). Text must start with a frontmatter block: "---\\nstatus: idea\\n---\\nbody". status: idea | plan | active | dropped | superseded.',
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            title: { type: "string" },
            text: { type: "string" },
          },
          required: ["title", "text"],
          additionalProperties: false,
        },
        execute: async ({ title, text }) => {
          try {
            const memory_id = slug(title)
            if (store.isSystem(memory_id)) return { content: "Refused: memory_id belongs to a system compaction." }
            if (store.exists(memory_id)) return { content: `Refused: a note with this title already exists (${memory_id}). Use compact_recall_update to change it.` }
            const { status, body } = parseNote(text)
            await store.save({
              memory_id,
              title,
              directory: ctx.location.directory ?? "",
              created_at: Date.now(),
              status,
              compaction_reason: "",
              full_text: body,
            })
            return { content: `Saved ${status} "${title}" (${memory_id}).` }
          } catch (e) {
            return { content: `Save failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
      editor.add({
        name: "compact_recall_update",
        description: 'Update an existing note by memory_id (from compact_recall_search). Fails if it does not exist. Pass the FULL new text (no partial edits), keeping the frontmatter block: "---\\nstatus: idea\\n---\\nbody". status: idea | plan | active | dropped | superseded. To retire a note, set status: dropped (dead end) or superseded (replaced — say by what and why in the body). Notes are never deleted.',
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            memory_id: { type: "string" },
            title: { type: "string" },
            text: { type: "string" },
          },
          required: ["memory_id", "title", "text"],
          additionalProperties: false,
        },
        execute: async ({ memory_id, title, text }) => {
          try {
            if (store.isSystem(memory_id)) return { content: "Refused: memory_id belongs to a system compaction." }
            const existing = await store.get(memory_id)
            if (!existing) return { content: `Note "${memory_id}" not found. Use compact_recall_save to create one.` }
            const { status, body } = parseNote(text)
            await store.save({
              memory_id,
              title,
              directory: existing.directory,
              created_at: existing.created_at,
              status,
              compaction_reason: "",
              full_text: body,
            })
            return { content: `Updated ${status} "${title}" (${memory_id}).` }
          } catch (e) {
            return { content: `Update failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
      editor.add({
        name: "compact_recall_inventory",
        description: "Count stored memories by source (opencode/claude/manual) and status. Use to see what exists overall; use compact_recall_search to find content.",
        options: { codemode: false },
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => {
          try {
            const { table, total } = store.inventory()
            const cols = ["system_compact", "idea", "plan", "active", "dropped", "superseded"]
            const cell = (v: number | null) => (v === null ? "–" : String(v))
            const lines = ["            opencode  claude  manual"]
            for (const c of cols)
              lines.push(`${c.padEnd(12)}${cell(table.opencode[c]).padEnd(10)}${cell(table.claude[c]).padEnd(8)}${cell(table.manual[c])}`)
            lines.push("", `total: ${total}`)
            return { content: lines.join("\n") }
          } catch (e) {
            return { content: `Inventory failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
      editor.add({
        name: "compact_recall_get",
        description: "Get the full text of a stored memory by memory_id (from compact_recall_search)",
        options: { codemode: false },
        input: {
          type: "object",
          properties: { memory_id: { type: "string" } },
          required: ["memory_id"],
          additionalProperties: false,
        },
        execute: async ({ memory_id }) => {
          try {
            const memory = await store.get(memory_id)
            return { content: memory ? JSON.stringify(memory, null, 2) : "Memory not found." }
          } catch (e) {
            return { content: `Get failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
    })

    return () => abort.abort()
  },
})
