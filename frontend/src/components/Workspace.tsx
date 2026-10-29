// The connected window: tab bar, one blank row, the tabs' panes, the status bar; the explorer,
// palette and search float over it.
//
// Every pane of every tab is a child of one element, keyed by its id, so a pane keeps its
// editor or shell when tabs are rearranged or a split terminal takes over its tab. Panes of
// other tabs are hidden, not unmounted.
import { Button } from '@heroui/react'
import type { CSSProperties, ReactNode } from 'react'
import * as A from '../lib/actions'
import { reconnect } from '../lib/connection'
import { basename } from '../lib/paths'
import * as S from '../lib/store'
import CommandPalette from './CommandPalette'
import EditorPane from './EditorPane'
import Explorer from './Explorer'
import ScmPane from './ScmPane'
import SearchModal from './SearchModal'
import TerminalPane from './TerminalPane'
import Welcome from './Welcome'

export function tabLabel(tab: S.Tab): string {
  if (S.focusedPane(tab) !== tab.id) return 'Terminal'
  switch (tab.kind) {
    case 'scm':
      return 'Source Control'
    case 'welcome':
      return 'Welcome'
    case 'terminal':
      return 'Terminal'
    case 'file':
      return tab.path ? basename(tab.path) : 'Untitled'
  }
}

function TabBar() {
  const tabs = S.useStore((s) => s.tabs)
  const active = S.useStore((s) => s.active)
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === active ? 'active' : ''}`}
          title={t.kind === 'file' && t.path ? t.path : undefined}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              A.closeTab(t.id)
            } else if (e.button === 0) {
              e.preventDefault()
              A.activate(t.id)
            }
          }}
        >
          {tabLabel(t)}
          {t.kind === 'file' && t.dirty && <span className="dot"> ●</span>}
        </div>
      ))}
    </div>
  )
}

const modeNames: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'VISUAL LINE',
  'visual-block': 'VISUAL BLOCK',
  replace: 'REPLACE',
  terminal: 'TERMINAL',
}

function StatusBar() {
  const tab = S.useStore((s) => s.tabs.find((t) => t.id === s.active))
  const status = S.useStore((s) => (tab ? s.status[S.focusedPane(tab)] : undefined))
  const conn = S.useStore((s) => s.conn)
  const mode = modeNames[status?.mode ?? 'normal'] ?? status?.mode?.toUpperCase() ?? 'NORMAL'
  const parts: ReactNode[] = []
  if (status?.errors) parts.push(<span className="error">✖ {status.errors}</span>)
  if (status?.warnings) parts.push(<span className="warn">▲ {status.warnings}</span>)
  for (const item of status?.items ?? []) if (item) parts.push(item)
  return (
    <div className="statusbar">
      <span className="left">
        {'  '}
        {mode}
        {conn.state === 'lost' && <span className="lost">{'    '}Disconnected</span>}
      </span>
      <span className="right">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && '    '}
            {p}
          </span>
        ))}
        {'  '}
      </span>
    </div>
  )
}

function LostBanner() {
  const conn = S.useStore((s) => s.conn)
  if (conn.state !== 'lost') return null
  return (
    <div className="lost-banner">
      <span>Lost the connection to the container.</span>
      <span className="why" title={conn.error}>
        {conn.error}
      </span>
      <Button size="sm" variant="primary" isDisabled={conn.reconnecting} onPress={() => reconnect()}>
        {conn.reconnecting ? 'Reconnecting…' : 'Reconnect'}
      </Button>
    </div>
  )
}

// Where a pane sits in its tab: the tab's content and its split terminals share the space
// evenly, stacked (below) or side by side (right).
function paneStyle(index: number, count: number, dir: S.Splits['dir'] | undefined): CSSProperties {
  if (count === 1 || !dir) return { inset: 0 }
  const size = 100 / count
  if (dir === 'below') return { left: 0, right: 0, top: `${index * size}%`, height: `${size}%` }
  return { top: 0, bottom: 0, left: `${index * size}%`, width: `${size}%` }
}

function content(tab: S.Tab, active: boolean, centered: boolean): ReactNode {
  switch (tab.kind) {
    case 'file':
      return <EditorPane tab={tab} active={active} centered={centered} />
    case 'terminal':
      return <TerminalPane id={tab.id} tabId={tab.id} cwd={tab.cwd} active={active} centered={centered} />
    case 'scm':
      return <ScmPane id={tab.id} active={active} />
    case 'welcome':
      return <Welcome id={tab.id} active={active} />
  }
}

function Panes() {
  const tabs = S.useStore((s) => s.tabs)
  const active = S.useStore((s) => s.active)
  const root = S.useStore((s) => (s.conn.state === 'connected' || s.conn.state === 'lost' ? s.conn.hello.root : '/'))
  return (
    <div className="panes">
      {tabs.flatMap((tab) => {
        const ids = [tab.id, ...(tab.splits?.panes ?? [])]
        const shown = tab.id === active
        const focused = S.focusedPane(tab)
        return ids.map((id, i) => (
          <div
            key={id}
            className={`pane ${shown ? '' : 'hidden'} ${tab.splits ? 'split-' + tab.splits.dir : ''}`}
            style={paneStyle(i, ids.length, tab.splits?.dir)}
            onMouseDownCapture={() => A.focusPane(tab.id, id)}
            onFocusCapture={() => A.focusPane(tab.id, id)}
          >
            {id === tab.id ? (
              content(tab, shown && focused === id, ids.length === 1)
            ) : (
              <TerminalPane id={id} tabId={tab.id} cwd={root} active={shown && focused === id} centered={false} />
            )}
          </div>
        ))
      })}
    </div>
  )
}

export default function Workspace() {
  const explorer = S.useStore((s) => s.explorer)
  const palette = S.useStore((s) => s.palette)
  const search = S.useStore((s) => s.search)
  return (
    <div className="workspace">
      <TabBar />
      <div className="tabbar-spacer" />
      <Panes />
      <StatusBar />
      <LostBanner />
      {explorer && <Explorer />}
      {palette && <CommandPalette mode={palette.mode} initial={palette.text ?? ''} />}
      {search && <SearchModal kind={search.kind} initial={search.text} />}
    </div>
  )
}
