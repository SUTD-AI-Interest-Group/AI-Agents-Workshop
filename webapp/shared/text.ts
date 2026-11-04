import type { TLRichText, TLShape } from '@tldraw/tlschema'

type RTNode = { type?: string; text?: string; content?: RTNode[] }

/** Flatten TipTap rich text: block nodes become lines, hard breaks become newlines. */
export function richTextToPlain(rt: TLRichText | undefined | null): string {
  if (!rt) return ''
  const lines: string[] = []
  const inline = (n: RTNode): string =>
    n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join('')
  const block = (n: RTNode) => {
    const kids = n.content ?? []
    if (kids.some((k) => k.type === 'paragraph' || k.type === 'heading' || k.type?.endsWith('List') || k.type === 'listItem')) {
      kids.forEach(block)
    } else lines.push(inline(n))
  }
  block(rt as RTNode)
  return lines.join('\n')
}

/** The human-readable text of a shape: rich text label for notes/text/geo/arrows, the name for frames. */
export function shapeText(shape: TLShape): string {
  const props = shape.props as { richText?: TLRichText; name?: string; text?: string }
  if (shape.type === 'frame') return props.name ?? ''
  if (props.richText) return richTextToPlain(props.richText)
  return props.text ?? ''
}

const MENTION_RE = /(^|[^\w@])@([A-Za-z][A-Za-z0-9_-]*)/g

/** Canonical crew names mentioned in `text` (case-insensitive, deduped, in order of first mention). */
export function parseMentions(text: string, crewNames: string[]): string[] {
  const byLower = new Map(crewNames.map((n) => [n.toLowerCase(), n]))
  const out: string[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    const name = byLower.get(m[2].toLowerCase())
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}
