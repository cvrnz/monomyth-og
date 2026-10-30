// What each open pane (an editor, a terminal, the explorer, Git, SQL) lets the rest of the
// app do with it, registered under the pane's id while it's mounted.
import type * as Monaco from 'monaco-editor'

export type PaneHandle = {
  focus(): void
  // Editors
  save?(as?: boolean, path?: string): Promise<boolean>
  isEmpty?(): boolean
  reveal?(line: number, col?: number): void
  vimEx?(command: string): void
  // Terminals: whether keys go to the shell (not in normal mode).
  shellInput?(): boolean
  editor?: Monaco.editor.ICodeEditor
  // Panes made of parts (a sidebar, an editor, results): Cmd+J/K moves through the parts
  // before going on to the tab's split terminals. step moves to the next (1) or previous (-1)
  // part, false at the last or first; enter focuses the first (1) or last (-1).
  step?(dir: number): boolean
  enter?(dir: number): void
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
