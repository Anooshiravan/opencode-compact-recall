import { expect, test } from "bun:test"
import { rowId, summaryId } from "../src/ids"

test("summary id is stable and message-specific", () => {
  expect(summaryId("s", "m1")).toBe(summaryId("s", "m1"))
  expect(summaryId("s", "m1")).not.toBe(summaryId("s", "m2"))
})

test("row id is deterministic and positive", () => {
  expect(rowId("abc", 0)).toBe(rowId("abc", 0))
  expect(rowId("abc", 1)).not.toBe(rowId("abc", 0))
  expect(rowId("abc", 0)).toBeGreaterThan(0n)
})
