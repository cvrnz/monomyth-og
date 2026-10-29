// What each open pane (an editor, a terminal, the source control view) lets the rest of the
// app do with it, registered under the pane's id while it's mounted.
import type * as Monaco from 'monaco-editor'

export type PaneHandle = {
  focus(): void
  // Editors
  save?(as?: boolean, path?: string): Promise<boolean>
  isEmpty?(): boolean
  reveal?(line: number, col?: number): void
  vimEx?(command: string): void
  vimInsert?(): boolean
  editor?: Monaco.editor.ICodeEditor
}

const handles = new Map<string, PaneHandle>()

export function register(id: string, handle: PaneHandle): () => void {
  handles.set(id, handle)
  return () => {
    if (handles.get(id) === handle) handles.delete(id)
  }
}

export function pane(id: string | undefined | null): PaneHandle | undefined {
  return id ? handles.get(id) : undefined
}
