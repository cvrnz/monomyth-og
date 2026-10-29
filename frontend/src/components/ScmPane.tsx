// Source control, like the nvim config's: a sidebar with two tabs, Repos (every git repo in
// the folder, its branch, commits to pull and push, and whether it has changes) and Changes
// (the selected repo's changed files, under a sync button). Moving through Changes shows a
// side-by-side diff on the right. Tab switches between the lists; Enter picks a repo, runs
// the sync button, or opens a file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agent, type Change, type Repo } from '../lib/agent'
import { openFile, root as rootPath } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { toast } from '../lib/dialogs'
import { languageFor, monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import { isInside, join, pretty } from '../lib/paths'
import * as S from '../lib/store'

type Busy = { repo: string; verb: string; frame: number } | { repo: string; text: string; cls: string }
type Row = { text: React.ReactNode; width: number; item?: { repo?: Repo; change?: Change; sync?: boolean } }

const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const lastFetch = new Map<string, number>()

export default function ScmPane({ id, active }: { id: string; active: boolean }) {
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [repo, setRepo] = useState<Repo | null>(null)
  const [files, setFiles] = useState<Change[]>([])
  const [view, setView] = useState<'repos' | 'changes'>('repos')
  const [sel, setSel] = useState({ repos: 0, changes: 0 })
  const [busy, setBusy] = useState<Busy | null>(null)
  const side = useRef<HTMLDivElement>(null)
  const diffHost = useRef<HTMLDivElement>(null)
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const repoRef = useRef<Repo | null>(null)
  repoRef.current = repo
  const hello = S.useStore((s) => (s.conn.state === 'connected' || s.conn.state === 'lost' ? s.conn.hello : null))
  const settings = S.useStore((s) => s.settings)

  const refresh = useCallback(async (pick?: (list: Repo[]) => Repo | undefined) => {
    const root = rootPath()
    let list: Repo[]
    try {
      list = await agent.repos([root])
    } catch (err) {
      toast(errorText(err), 'error')
      return
    }
    setRepos(list)
    let current = repoRef.current ? list.find((r) => r.path === repoRef.current!.path) ?? null : null
    const picked = pick?.(list)
    if (picked) current = picked
    setRepo(current)
    if (current) {
      agent.changes(current.path).then(setFiles, () => setFiles([]))
    }
    // Fetch in the background so the pull counts are current, at most once a minute a repo.
    for (const r of list) {
      if (!r.sync || Date.now() - (lastFetch.get(r.path) ?? 0) < 60000) continue
      lastFetch.set(r.path, Date.now())
      agent.fetch(r.path, r.name).then(
        (fresh) => {
          setRepos((rs) => rs?.map((x) => (x.path === fresh.path ? fresh : x)) ?? rs)
          setRepo((cur) => (cur?.path === fresh.path ? fresh : cur))
        },
        () => {},
      )
    }
    return { list, current }
  }, [])

  // Start on the repo the folder is in, if any; otherwise on the repo list.
  useEffect(() => {
    const root = rootPath()
    refresh((list) => list.find((r) => isInside(root, r.path))).then((res) => {
      if (res?.current) {
        setView('changes')
        setSel({ repos: res.list.indexOf(res.current), changes: 0 })
      }
    })
  }, [refresh])

  // Pick up edits made elsewhere when coming back to the window or the tab.
  useEffect(() => {
    if (!active) return
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [active, refresh])
  const wasActive = useRef(active)
  useEffect(() => {
    if (active && !wasActive.current) refresh()
    wasActive.current = active
  }, [active, refresh])

  const action = repo?.action ?? null
  const syncRow = useMemo((): Row | null => {
    if (!repo) return null
    if (busy && busy.repo === repo.path) {
      if ('verb' in busy) {
        const text = `${spinner[busy.frame % spinner.length]} ${busy.verb}…`
        return { text: <span className="dim">{text}</span>, width: text.length, item: { sync: true } }
      }
      return { text: <span className={busy.cls}>{busy.text}</span>, width: busy.text.length, item: { sync: true } }
    }
    if (!action) return null
    return { text: <span className={action.dim ? 'dim' : ''}>{action.label}</span>, width: action.label.length, item: { sync: true } }
  }, [repo, busy, action])

  const repoRows = useMemo((): Row[] => {
    if (!repos) return [{ text: <span className="dim">Looking for repos…</span>, width: 20 }]
    if (repos.length === 0) {
      const text = `No git repos in ${pretty(rootPath(), '', hello?.home ?? '')}`
      return [{ text: <span className="dim">{text}</span>, width: text.length }]
    }
    const nameWidth = Math.max(...repos.map((r) => r.name.length))
    return repos.map((r) => {
      const name = r.name.padEnd(nameWidth)
      const parts = [r.count > 0 ? '●' : ' ', ' ', name, '  ', r.branch]
      let width = parts.join('').length
      if (r.arrows) width += 2 + r.arrows.length
      if (r.count > 0) width += 2 + String(r.count).length
      return {
        width,
        item: { repo: r },
        text: (
          <>
            <span className="warnc">{r.count > 0 ? '●' : ' '}</span> <span style={repo?.path === r.path ? { color: 'var(--blue)', fontWeight: 'bold' } : undefined}>{r.name}</span>
            {' '.repeat(nameWidth - r.name.length)}
            {'  '}
            <span className="dim">{r.branch}</span>
            {r.arrows && <>{'  '}{r.arrows}</>}
            {r.count > 0 && (
              <>
                {'  '}
                <span className="warnc">{r.count}</span>
              </>
            )}
          </>
        ),
      }
    })
  }, [repos, repo, hello])

  const changeRows = useMemo((): Row[] => {
    if (!repo) return [{ text: <span className="dim">Pick a repo in Repos</span>, width: 20 }]
    const rows: Row[] = []
    if (syncRow) rows.push(syncRow, { text: '', width: 0 })
    for (const c of files) {
      rows.push({
        width: 3 + c.path.length,
        item: { change: c },
        text: (
          <>
            <span className={`st-${c.status}`}>{c.status}</span>
            {'  '}
            {c.path}
          </>
        ),
      })
    }
    if (files.length === 0) rows.push({ text: <span className="dim">No changes</span>, width: 10 })
    return rows
  }, [repo, files, syncRow])

  const rows = view === 'repos' ? repoRows : changeRows
  // Only rows with something on them can be selected.
  const selectable = rows.map((r, i) => (r.item ? i : -1)).filter((i) => i >= 0)
  const cursor = selectable.includes(sel[view]) ? sel[view] : (selectable[0] ?? -1)
  const entry = cursor >= 0 ? rows[cursor].item : undefined
  const shownChange = view === 'changes' ? entry?.change : undefined

  // Sidebar as wide as its widest line (both lists), up to half the pane.
  const sideWidth = Math.max(18, ...repoRows.map((r) => r.width), ...changeRows.map((r) => r.width)) + 3

  // Status bar: the selected repo, its branch and commits to pull and push.
  useEffect(() => {
    const label = repo ? [repo.name, repo.branch, repo.arrows].filter(Boolean).join('  ') : 'Source Control'
    S.setPaneStatus(id, { mode: 'normal', items: [label] })
  }, [id, repo])
  useEffect(
    () => () =>
      S.set((s) => {
        const status = { ...s.status }
        delete status[id]
        return { status }
      }),
    [id],
  )

  // The diff editor.
  useEffect(() => {
    const st = S.get().settings
    const diff = monaco.editor.createDiffEditor(diffHost.current!, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      enableSplitViewResizing: true,
      fontFamily: st.fontFamily,
      fontSize: st.fontSize,
      lineNumbers: st.lineNumbers ? 'on' : 'off',
      minimap: { enabled: false },
      folding: false,
      glyphMargin: false,
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      lineDecorationsWidth: '2ch',
      renderIndicators: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      hideUnchangedRegions: { enabled: false },
      stickyScroll: { enabled: false },
    })
    diffRef.current = diff
    const unregister = register(id, { focus: () => side.current?.focus() })
    return () => {
      unregister()
      const m = diff.getModel()
      diff.dispose()
      m?.original.dispose()
      m?.modified.dispose()
    }
  }, [id])

  useEffect(() => {
    diffRef.current?.updateOptions({ fontSize: settings.fontSize, fontFamily: settings.fontFamily, lineNumbers: settings.lineNumbers ? 'on' : 'off' })
  }, [settings.fontSize, settings.fontFamily, settings.lineNumbers])

  // Show the selected change's diff.
  const seq = useRef(0)
  useEffect(() => {
    const diff = diffRef.current
    if (!diff) return
    const n = ++seq.current
    const show = (old: string, now: string, path: string | null) => {
      const prev = diff.getModel()
      const lang = languageFor(path, now.split('\n', 1)[0])
      diff.setModel({ original: monaco.editor.createModel(old, lang), modified: monaco.editor.createModel(now, lang) })
      prev?.original.dispose()
      prev?.modified.dispose()
    }
    if (!shownChange || !repo) {
      show('', '', null)
      return
    }
    agent.versions(repo.path, shownChange).then(
      (v) => {
        if (n === seq.current) show(v.old.content, v.new.content, shownChange.path)
      },
      (err) => toast(errorText(err), 'error'),
    )
  }, [shownChange, repo])

  useEffect(() => {
    if (active) requestAnimationFrame(() => side.current?.focus())
  }, [active])

  const selectRepo = async (r: Repo) => {
    setRepo(r)
    setView('changes')
    let list: Change[] = []
    try {
      list = await agent.changes(r.path)
    } catch (err) {
      toast(errorText(err), 'error')
    }
    setFiles(list)
    // Start on the first changed file (or the sync button when nothing has changed).
    const offset = r.action ? 2 : 0
    setSel((s) => ({ ...s, changes: list.length ? offset : 0 }))
  }

  const runSync = async () => {
    const target = repoRef.current
    if (!target?.action || (busy && 'verb' in busy)) return
    const a = target.action
    let frame = 0
    setBusy({ repo: target.path, verb: a.verb, frame })
    const timer = setInterval(() => setBusy({ repo: target.path, verb: a.verb, frame: ++frame }), 80)
    let err: string | null = null
    try {
      await agent.sync(target.path)
      lastFetch.set(target.path, Date.now())
    } catch (e) {
      err = errorText(e)
    }
    clearInterval(timer)
    const done: Busy = err
      ? { repo: target.path, text: `✕ ${a.verb.replace(/ing$/, '')} failed`, cls: 'bad' }
      : { repo: target.path, text: `✓ ${a.done}`, cls: 'ok' }
    setBusy(done)
    if (err) toast(err, 'error')
    await refresh()
    setTimeout(() => setBusy((b) => (b === done ? null : b)), err ? 4000 : 2500)
  }

  const choose = (item: Row['item']) => {
    if (!item) return
    if (item.repo) selectRepo(item.repo)
    else if (item.sync) runSync()
    else if (item.change && repo && item.change.status !== 'D') openFile(join(repo.path, item.change.path))
  }

  const move = (step: number) => {
    if (selectable.length === 0) return
    const i = selectable.indexOf(cursor)
    const next = selectable[Math.min(selectable.length - 1, Math.max(0, i + step))]
    setSel((s) => ({ ...s, [view]: next }))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const key = e.key
    if (key === 'Tab') {
      setView((v) => (v === 'repos' ? 'changes' : 'repos'))
    } else if (key === 'j' || key === 'ArrowDown') move(1)
    else if (key === 'k' || key === 'ArrowUp') move(-1)
    else if (key === 'g' || key === 'Home') move(-1e9)
    else if (key === 'G' || key === 'End') move(1e9)
    else if (key === 'Enter' || key === 'o') choose(entry)
    else if (key === 'R') refresh()
    else if (key === ':') S.set({ palette: { mode: 'commands' } })
    else return
    e.preventDefault()
  }

  // Keep the selected row in view.
  useEffect(() => {
    side.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, view])

  const label = (c: Change | undefined, which: 'old' | 'new') =>
    c ? ` ${which === 'old' ? (c.old ?? c.path) : c.path}  (${which === 'old' ? 'last commit' : 'working tree'})` : ' '

  return (
    <div className="scm">
      <div className="scm-side" ref={side} tabIndex={0} onKeyDown={onKeyDown} style={{ width: `${sideWidth}ch` }}>
        <div className="scm-tabs">
          <span className={view === 'repos' ? 'on' : ''} onMouseDown={() => setView('repos')}>
            Repos
          </span>{' '}
          <span className={view === 'changes' ? 'on' : ''} onMouseDown={() => setView('changes')}>
            Changes
          </span>
        </div>
        <div className="row" />
        {rows.map((r, i) => (
          <div
            key={i}
            className={`row ${i === cursor ? 'selected' : ''}`}
            onMouseDown={() => r.item && setSel((s) => ({ ...s, [view]: i }))}
            onDoubleClick={() => choose(r.item)}
            onClick={() => r.item && view === 'changes' && r.item.sync && runSync()}
          >
            {r.text}
          </div>
        ))}
      </div>
      <div className="scm-diff">
        <div className="scm-labels">
          <div>{label(shownChange, 'old')}</div>
          <div>{label(shownChange, 'new')}</div>
        </div>
        <div className="scm-editor">
          <div ref={diffHost} style={{ position: 'absolute', inset: 0, visibility: shownChange ? undefined : 'hidden' }} />
        </div>
      </div>
    </div>
  )
}
