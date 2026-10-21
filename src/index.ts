import { Plugin } from "@opencode/plugin"
import { config } from "./config"
import { findSummary, type Summary } from "./capture"
import { summaryId } from "./ids"
import { Store } from "./store"
import { dbg } from "./log"

const log = (e: unknown) => {
  console.error(`compact-recall: ${e instanceof Error ? e.message : e}`)
  dbg("error", { message: e instanceof Error ? e.message : String(e) })
}


const seen = new Set<string>()

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
        dbg("capture", { sessionID, messageID: message.id, chars: message.summary.length })
        const summary: Summary = {
          summary_id: summaryId(sessionID, message.id),
          session_id: sessionID,
          message_id: message.id,
          title: "",
          project: session.projectID ?? "",
          directory: session.location?.directory ?? "",
          created_at: message.time.created,
          reason: message.reason ?? "",
          text: message.summary,
        }
        try {
          await store.save(summary)
          dbg("saved", { summary_id: summary.summary_id, chars: summary.text.length })
        } catch (e) {
          log(e)
        }
      } catch (e) {
        log(e)
      }
    }

    const abort = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (event.type === "session.step.ended") await capture((event as any).data.sessionID)
      }
    })().catch(log)

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "compact_recall_search",
        description: "Semantically search summaries of past (compacted) conversations. Use when asked to recall what was discussed, decided or done in earlier sessions.",
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
            all_projects: { type: "boolean" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async ({ query, limit = 5, all_projects = false }) => {
          dbg("search", { query, limit, all_projects })
          try {
            const hits = await store.search(query, limit, all_projects ? undefined : ctx.location.project.id)
            dbg("search result", { hits: hits.map((h) => ({ id: h.summary_id, score: h.score, rel: h.relative })) })
            return { content: hits.length ? JSON.stringify(hits, null, 2) : "No matching summaries." }
          } catch (e) {
            return { content: `Search failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
      editor.add({
        name: "compact_recall_get",
        description: "Get the full text of a past-conversation summary by summary_id (from compact_recall_search)",
        options: { codemode: false },
        input: {
          type: "object",
          properties: { summary_id: { type: "string" } },
          required: ["summary_id"],
          additionalProperties: false,
        },
        execute: async ({ summary_id }) => {
          dbg("get", { summary_id })
          try {
            const summary = await store.get(summary_id)
            dbg("get result", { found: !!summary })
            return { content: summary ? JSON.stringify(summary, null, 2) : "Summary not found." }
          } catch (e) {
            return { content: `Get failed: ${e instanceof Error ? e.message : e}` }
          }
        },
      })
    })

    return () => abort.abort()
  },
})
