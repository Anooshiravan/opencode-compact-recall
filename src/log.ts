import { appendFileSync } from "fs"
import { config } from "./config"

export const dbg = (msg: string, data?: unknown) => {
  if (!config.debug) return
  const line = `${new Date().toISOString()} ${msg}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`
  try {
    appendFileSync(config.debug, line)
  } catch {}
}
