// The parts of a pane (a sidebar, an editor, results) that Cmd+J/K moves between, and which
// one has the focus, for the hints line.
import { useRef, useState } from 'react'

export type Part = { name: string; focus(): void }

export function useParts(initial: string) {
  const [part, setPart] = useState(initial)
  // The parts there are now, in order; set by the pane as it renders.
  const list = useRef<Part[]>([])
  // The part the focus is in, by name (a pane can say more exactly, as Git's lists).
  const current = useRef(part)
  current.current = part
  const [nav] = useState(() => ({
    step(dir: number): boolean {
      const l = list.current
      const i = l.findIndex((p) => p.name === current.current)
      const next = i < 0 ? undefined : l[i + dir]
      if (!next) return false
      next.focus()
      return true
    },
    enter(dir: number) {
      const l = list.current
      ;(dir > 0 ? l[0] : l[l.length - 1])?.focus()
    },
  }))
  return { part, setPart, list, current, nav }
}
