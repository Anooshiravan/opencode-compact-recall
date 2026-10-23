import { createHash } from "crypto"

export const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") ||
  createHash("sha256").update(title).digest("hex").slice(0, 12)

export const rowId = (id: string, chunk: number) =>
  createHash("sha1").update(`${id}/${chunk}`).digest().readBigUInt64BE() >> 1n
