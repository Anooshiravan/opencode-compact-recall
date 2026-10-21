import { createHash } from "crypto"

export const summaryId = (sessionID: string, messageID: string) =>
  createHash("sha256").update(`${sessionID}/${messageID}`).digest("hex").slice(0, 32)

export const rowId = (id: string, chunk: number) =>
  createHash("sha1").update(`${id}/${chunk}`).digest().readBigUInt64BE() >> 1n
