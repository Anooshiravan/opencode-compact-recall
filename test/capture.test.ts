import { expect, test } from "bun:test"
import { findSummary } from "../src/capture"

const done = (id: string, summary = "text") => ({ type: "compaction", status: "completed", id, summary })

test("picks newest completed compaction", () => {
  const messages = [done("a"), { type: "user", id: "u" }, done("b")]
  expect(findSummary(messages)?.id).toBe("b")
})

test("ignores failed, empty and other types", () => {
  expect(findSummary([{ type: "compaction", status: "failed", id: "a" }])).toBeUndefined()
  expect(findSummary([done("a", "  ")])).toBeUndefined()
  expect(findSummary([{ type: "assistant", status: "completed", id: "a", summary: "x" }])).toBeUndefined()
  expect(findSummary([])).toBeUndefined()
})
