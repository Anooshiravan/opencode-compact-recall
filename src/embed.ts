import { pipeline } from "@huggingface/transformers"
import { config } from "./config"

let extractor: any

export async function embed(texts: string[]): Promise<number[][]> {
  extractor ??= await pipeline("feature-extraction", config.model)
  const out = await extractor(texts, { pooling: "mean", normalize: true })
  const dims = out.dims.at(-1)
  return Array.from({ length: out.dims[0] }, (_, i) =>
    Array.from(out.data.subarray(i * dims, (i + 1) * dims) as ArrayLike<number>),
  )
}

export const embedQuery = (query: string) =>
  embed([`Represent this sentence for searching relevant passages: ${query}`]).then(([v]) => v)
