import { expect, mock, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { Store } from "../src/store"
import type { Memory } from "../src/capture"

mock.module("../src/embed", () => ({
  embed: async (texts: string[]) =>
    texts.map((t) => (t.includes("hello") ? [1, 0] : t.includes("bye") ? [0, 1] : [0.5, 0.5])),
  embedQuery: async (q: string) => (q.includes("hello") ? [1, 0] : q.includes("bye") ? [0, 1] : [0.5, 0.5]),
}))

const memory = (over: Partial<Memory> = {}): Memory => ({
  memory_id: "abc",
  title: "",
  directory: "/d",
  created_at: 1,
  status: "system_compact",
  compaction_reason: "manual",
  full_text: "## A\nhello",
  ...over,
})

const tempStore = async () => {
  const path = join(await mkdtemp(join(tmpdir(), "cr-")), "recall.db")
  return new Store(path)
}

test("save, search and get", async () => {
  const store = await tempStore()
  await store.save(memory())
  await store.save(memory({ memory_id: "def", full_text: "## A\nbye" }))

  const hits = await store.search("hello", 5)
  expect(hits.length).toBe(1)
  expect(hits[0].memory_id).toBe("abc")

  expect((await store.get("def"))?.full_text).toBe("## A\nbye")
  expect(await store.get("zzz")).toBeUndefined()
})

test("scores are calibrated and relative to top hit", async () => {
  const store = await tempStore()
  await store.save(memory({ full_text: "## A\nzzz" }))
  await store.save(memory({ memory_id: "def", full_text: "## hello\nhello" }))
  const hits = await store.search("hello", 5)
  expect(hits.map((h) => h.memory_id)).toEqual(["def", "abc"])
  expect(hits[0].score).toBeCloseTo(0.7)
  expect(hits[0].relative).toBe(1)
  expect(hits[1].relative).toBeCloseTo(0.49)
})

test("re-save replaces, does not duplicate", async () => {
  const store = await tempStore()
  await store.save(memory())
  await store.save(memory())
  expect((await store.search("hello", 5)).length).toBe(1)
})

test("isSystem guards compaction ids", async () => {
  const store = await tempStore()
  await store.save(memory())
  await store.save(memory({ memory_id: "my-note", status: "idea", full_text: "## hello" }))
  expect(store.isSystem("abc")).toBe(true)
  expect(store.isSystem("my-note")).toBe(false)
  expect(store.isSystem("nope")).toBe(false)
})

test("exists reports known ids", async () => {
  const store = await tempStore()
  await store.save(memory())
  expect(store.exists("abc")).toBe(true)
  expect(store.exists("nope")).toBe(false)
})

test("inventory counts by source and status", async () => {
  const store = await tempStore()
  await store.save(memory({ memory_id: "ses_x" }))
  await store.save(memory({ memory_id: "claude-y", full_text: "## A\nbye" }))
  await store.save(memory({ memory_id: "my-note", status: "idea", full_text: "## A\nhello" }))
  const { table, total } = store.inventory()
  expect(total).toBe(3)
  expect(table.opencode.system_compact).toBe(1)
  expect(table.claude.system_compact).toBe(1)
  expect(table.manual.idea).toBe(1)
  expect(table.opencode.idea).toBeNull()
  expect(table.manual.system_compact).toBeNull()
})

test("keyword-only hit survives weak semantics", async () => {
  const store = await tempStore()
  await store.save(memory({ memory_id: "gpu", full_text: "## A\nH200 vLLM deploy" }))
  const hits = await store.search("zzz H200", 5)
  expect(hits.map((h) => h.memory_id)).toEqual(["gpu"])
})

test("dimension mismatch throws", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "cr-")), "recall.db")
  const store = new Store(path)
  await store.save(memory())
  mock.module("../src/embed", () => ({ embed: async (texts: string[]) => texts.map(() => [1, 0, 0]), embedQuery: async () => [1, 0, 0] }))
  expect(new Store(path).save(memory({ memory_id: "xyz" }))).rejects.toThrow("dims")
})
