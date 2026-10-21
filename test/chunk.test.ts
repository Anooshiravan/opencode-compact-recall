import { expect, test } from "bun:test"
import { chunk } from "../src/chunk"

test("splits at headings", () => {
  const parts = chunk("## A\nalpha\n## B\nbeta")
  expect(parts).toEqual(["## A\nalpha", "## B\nbeta"])
})

test("splits oversized sections with overlap", () => {
  const text = "## A\n" + "x".repeat(30)
  const parts = chunk(text, 10, 4)
  expect(parts[0]).toBe(text.slice(0, 10))
  expect(parts[1]).toBe(text.slice(6, 16))
  expect(parts.at(-1)!.endsWith("x")).toBe(true)
  expect(parts.every((p) => p.length <= 10)).toBe(true)
})

test("no duplicate tail chunk", () => {
  const parts = chunk("y".repeat(12), 10, 4)
  expect(parts).toEqual(["y".repeat(10), "y".repeat(6)])
})

test("drops blank sections", () => {
  expect(chunk("   \n")).toEqual([])
})
