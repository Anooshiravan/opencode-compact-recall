import { expect, mock, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { Store } from "../src/store"
import type { Summary } from "../src/capture"

mock.module("../src/embed", () => ({
  embed: async (texts: string[]) =>
    texts.map((t) => (t.includes("hello") ? [1, 0] : t.includes("bye") ? [0, 1] : [0.5, 0.5])),
  embedQuery: async (q: string) => (q.includes("hello") ? [1, 0] : q.includes("bye") ? [0, 1] : [0.5, 0.5]),
}))

const summary = (over: Partial<Summary> = {}): Summary => ({
  summary_id: "abc",
  session_id: "s",
  message_id: "m",
  title: "t",
  project: "p",
  directory: "/d",
  created_at: 1,
  reason: "manual",
  text: "## A\nhello",
  ...over,
})

const tempStore = async () => {
  const path = join(await mkdtemp(join(tmpdir(), "cr-")), "recall.db")
  return [new Store(path), path] as const
}

test("save, search and get", async () => {
  const [store] = await tempStore()
  await store.save(summary())
  await store.save(summary({ summary_id: "def", session_id: "s2", message_id: "m2", text: "## A\nbye" }))

  const hits = await store.search("hello", 5)
  expect(hits.length).toBe(1)
  expect(hits[0].summary_id).toBe("abc")

  expect((await store.get("def"))?.text).toBe("## A\nbye")
  expect(await store.get("zzz")).toBeUndefined()
})

test("scores are calibrated and relative to top hit", async () => {
  const [store] = await tempStore()
  await store.save(summary({ text: "## A\nzzz" }))
  await store.save(summary({ summary_id: "def", session_id: "s2", message_id: "m2", text: "## hello\nhello" }))
  const hits = await store.search("hello", 5)
  expect(hits.map((h) => h.summary_id)).toEqual(["def", "abc"])
  expect(hits[0].score).toBeCloseTo(0.7)
  expect(hits[0].relative).toBe(1)
  expect(hits[1].relative).toBeCloseTo(0.49)
})

test("search filters by project", async () => {
  const [store] = await tempStore()
  await store.save(summary())
  expect((await store.search("hello", 5, "other")).length).toBe(0)
  expect((await store.search("hello", 5, "p")).length).toBe(1)
})

test("re-save overwrites, does not duplicate", async () => {
  const [store] = await tempStore()
  await store.save(summary())
  await store.save(summary())
  expect((await store.search("hello", 5)).length).toBe(1)
})

test("newer summary of same session replaces older one", async () => {
  const [store] = await tempStore()
  await store.save(summary())
  await store.save(summary({ summary_id: "def", message_id: "m2", text: "## A\nbye" }))
  expect((await store.search("hello", 5)).length).toBe(0)
  expect(await store.get("abc")).toBeUndefined()
  expect((await store.get("def"))?.text).toBe("## A\nbye")
})

test("dimension mismatch throws", async () => {
  const [, path] = await tempStore()
  const store = new Store(path)
  await store.save(summary())
  mock.module("../src/embed", () => ({ embed: async (texts: string[]) => texts.map(() => [1, 0, 0]) }))
  expect(new Store(path).save(summary({ summary_id: "xyz", message_id: "m9" }))).rejects.toThrow("dims")
})
