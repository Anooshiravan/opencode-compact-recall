import { appendFileSync, renameSync, statSync } from "fs"
import { config } from "./config"

const MAX_BYTES = 1_000_000

// Errors and stream-lifecycle only; never routine events. Rotates at ~1 MB.
export const logError = (msg: string, data?: unknown) => {
  const line = `${new Date().toISOString()} ${msg}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`
  try {
    try {
      if (statSync(config.log).size > MAX_BYTES) renameSync(config.log, `${config.log}.1`)
    } catch {}
    appendFileSync(config.log, line)
  } catch {}
}
