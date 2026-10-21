export function chunk(text: string, maxChars = 1600, overlap = 200): string[] {
  const out: string[] = []
  const stride = maxChars - overlap
  for (const section of text.split(/(?=^#{1,6} )/m)) {
    const body = section.replace(/\s+$/, "")
    for (let i = 0; i < body.length; i += stride) {
      const part = body.slice(i, i + maxChars)
      if (part.trim()) out.push(part)
      if (body.length <= i + maxChars) break
    }
  }
  return out
}
