import { expect, test } from "bun:test"
import { rowId, slug } from "../src/ids"

test("slug is stable kebab-case", () => {
  expect(slug("Hello, World!")).toBe("hello-world")
  expect(slug("My Brain Design")).toBe("my-brain-design")
})

test("slug falls back to hash when empty", () => {
  expect(slug("🚀")).toMatch(/^[0-9a-f]{12}$/)
})

test("row id is deterministic and positive", () => {
  expect(rowId("abc", 0)).toBe(rowId("abc", 0))
  expect(rowId("abc", 1)).not.toBe(rowId("abc", 0))
  expect(rowId("abc", 0)).toBeGreaterThan(0n)
})
