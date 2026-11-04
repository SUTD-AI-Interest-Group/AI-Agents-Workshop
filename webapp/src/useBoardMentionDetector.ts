import { useEffect, useRef } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import type { CrewInfo } from '../shared/protocol'
import { parseMentions, shapeText } from '../shared/text'
import { api } from './api'
import type { StoredSession } from './session'

/** When someone finishes editing a shape whose text @mentions a crew, report it (the server dedupes). */
export function useBoardMentionDetector(editor: Editor | null, crews: CrewInfo[], session: StoredSession) {
  const names = useRef<string[]>([])
  names.current = crews.map((c) => c.name)

  useEffect(() => {
    if (!editor) return
    let prev: TLShapeId | null = editor.getEditingShapeId()
    const check = (id: TLShapeId) => {
      const shape = editor.getShape(id)
      if (!shape) return
      if (!parseMentions(shapeText(shape), names.current).length) return
      api('/api/mentions/board', { shapeId: id }, session).catch(() => {})
    }
    return editor.store.listen(
      () => {
        const cur = editor.getEditingShapeId()
        if (cur === prev) return
        if (prev) check(prev)
        prev = cur
      },
      { scope: 'session' },
    )
  }, [editor, session])
}
