// Picking where to work: a recent place, a folder on this computer, or a project, pod and
// container from `oc`.
import { Button, Spinner } from '@heroui/react'
import { useCallback, useEffect, useState } from 'react'
import { errorText, invoke } from '../lib/bridge'
import { connect, forget } from '../lib/connection'
import { basename } from '../lib/paths'
import { updateSettings } from '../lib/settings'
import * as S from '../lib/store'

type Pod = { name: string; workspace?: string; containers: string[]; ready: boolean }

// Dev Spaces adds sidecars (the gateway, ...); the container people work in is the other one.
function defaultContainer(containers: string[]): string {
  return containers.find((c) => !/gateway|sidecar|proxy|che-/.test(c)) ?? containers[0] ?? ''
}

function describe(t: S.Target) {
  return t.local ? basename(t.folder) : t.workspace || t.pod
}

function details(t: S.Target) {
  return t.local ? `this computer · ${t.folder}` : `${t.project} · ${t.container} · ${t.folder || '~'}`
}

export default function ConnectScreen() {
  const conn = S.useStore((s) => s.conn)
  const recents = S.useStore((s) => s.settings.recents)
  const ocPath = S.useStore((s) => s.settings.ocPath ?? '')

  const [projects, setProjects] = useState<string[] | null>(null)
  const [project, setProject] = useState('')
  const [pods, setPods] = useState<Pod[] | null>(null)
  const [pod, setPod] = useState<Pod | null>(null)
  const [container, setContainer] = useState('')
  const [folder, setFolder] = useState('')
  const [localFolder, setLocalFolder] = useState('')
  const [ocError, setOcError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [ocDraft, setOcDraft] = useState(ocPath)

  const busy = conn.state === 'connecting'
  const shownError = error || (conn.state === 'idle' ? (conn.error ?? '') : '')
  // No oc at all is normal for someone editing local files only: not an error.
  const noOc = /couldn't find the oc command/.test(ocError)

  const loadPods = useCallback(async (p: string) => {
    setProject(p)
    setPods(null)
    setPod(null)
    setOcError('')
    setLoading('Loading pods…')
    try {
      const list = await invoke<Pod[]>('OcPods', p)
      setPods(list)
      const first = list.find((x) => x.ready) ?? list[0]
      if (first) {
        setPod(first)
        setContainer(defaultContainer(first.containers))
      }
    } catch (err) {
      setOcError(errorText(err))
    } finally {
      setLoading('')
    }
  }, [])

  const loadProjects = useCallback(async () => {
    setOcError('')
    setProjects(null)
    setLoading('Loading projects…')
    try {
      const res = await invoke<{ names: string[] | null; current: string }>('OcProjects')
      const names = res.names ?? []
      if (res.current && !names.includes(res.current)) names.unshift(res.current)
      setProjects(names)
      setLoading('')
      const start = res.current || names[0]
      if (start) await loadPods(start)
    } catch (err) {
      setProjects([])
      setLoading('')
      setOcError(errorText(err))
    }
  }, [loadPods])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const go = () => {
    if (!pod || busy) return
    setError('')
    connect({ project, pod: pod.name, workspace: pod.workspace, container, folder: folder.trim() })
  }

  const openLocal = (path: string) => {
    const dir = path.trim()
    if (busy) return
    if (!dir) {
      setError('Pick a folder, or type its path.')
      return
    }
    setError('')
    connect(S.localTarget(dir))
  }

  const browse = async () => {
    try {
      const dir = await invoke<string>('PickFolder')
      if (dir) {
        setLocalFolder(dir)
        openLocal(dir)
      }
    } catch (err) {
      setError(errorText(err))
    }
  }

  // A recent workspace's pod gets a new name when the workspace restarts; find it again.
  const openRecent = async (t: S.Target) => {
    if (busy) return
    setError('')
    let target = t
    if (t.workspace && !t.local) {
      try {
        setLoading(`Finding ${t.workspace}…`)
        const list = await invoke<Pod[]>('OcPods', t.project)
        const match = list.find((p) => p.workspace === t.workspace && p.ready) ?? list.find((p) => p.workspace === t.workspace)
        if (!match) {
          setError(`The workspace ${t.workspace} isn't running in ${t.project}. Start it from Dev Spaces, then try again.`)
          return
        }
        target = { ...t, pod: match.name, container: match.containers.includes(t.container) ? t.container : defaultContainer(match.containers) }
      } catch (err) {
        setError(errorText(err))
        return
      } finally {
        setLoading('')
      }
    }
    connect(target)
  }

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      fn()
    }
  }

  return (
    <div className="connect">
      <div className="connect-inner">
        <h1>Monomyth</h1>
        <div className="sub">Edit files on this computer, or in an OpenShift or Dev Spaces container.</div>

        {busy && (
          <div className="status">
            <Spinner size="sm" /> {conn.status}
          </div>
        )}
        {!busy && loading && projects !== null && pods !== null && (
          <div className="status">
            <Spinner size="sm" /> {loading}
          </div>
        )}
        {shownError && <div className="error">{shownError}</div>}

        {recents.length > 0 && (
          <>
            <h2>Recent</h2>
            <div className="pick-list">
              {recents.map((t) => (
                <div key={`${t.local ? 'local' : t.project}/${describe(t)}/${t.container}/${t.folder}`} className="pick" onClick={() => openRecent(t)}>
                  <span className="name">{describe(t)}</span>
                  <span className="meta">{details(t)}</span>
                  <span
                    className="x"
                    title="Forget"
                    onClick={(e) => {
                      e.stopPropagation()
                      forget(t)
                    }}
                  >
                    ✕
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <h2>This computer</h2>
        <div className="row-fields">
          <div className="field">
            <input
              className="text-input"
              placeholder="A folder's path, or choose one"
              value={localFolder}
              spellCheck={false}
              onChange={(e) => setLocalFolder(e.target.value)}
              onKeyDown={onEnter(() => openLocal(localFolder))}
            />
          </div>
          <Button variant="secondary" isDisabled={busy} onPress={browse}>
            Choose…
          </Button>
          <Button variant="primary" isDisabled={busy || !localFolder.trim()} onPress={() => openLocal(localFolder)}>
            Open
          </Button>
        </div>

        <h2>OpenShift</h2>
        {projects === null ? (
          <div className="status">
            <Spinner size="sm" /> {loading}
          </div>
        ) : noOc ? (
          <div className="help">
            To edit files in a container, install the <code>oc</code> command and log in with <code>oc login</code>, or set its path below.
          </div>
        ) : projects.length === 0 ? (
          <div className="help">
            No projects. Log in with <code>oc login</code> in a terminal, then refresh.
          </div>
        ) : (
          <>
            <div className="label">Project</div>
            <div className="pick-list">
              {projects.map((p) => (
                <div key={p} className={`pick ${p === project ? 'on' : ''}`} onClick={() => loadPods(p)}>
                  <span className="name">{p}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {ocError && !noOc && <div className="error">{ocError}</div>}

        {project && projects && projects.length > 0 && (
          <>
            <div className="label">Pod</div>
            {pods === null ? (
              loading && (
                <div className="status">
                  <Spinner size="sm" /> {loading}
                </div>
              )
            ) : pods.length === 0 ? (
              <div className="help">No running pods in {project}. Start a workspace, then refresh.</div>
            ) : (
              <div className="pick-list">
                {pods.map((p) => (
                  <div
                    key={p.name}
                    className={`pick ${pod?.name === p.name ? 'on' : ''}`}
                    onClick={() => {
                      setPod(p)
                      setContainer(defaultContainer(p.containers))
                    }}
                    onDoubleClick={go}
                  >
                    <span className="name">{p.workspace || p.name}</span>
                    <span className="meta">
                      {p.workspace ? p.name + ' · ' : ''}
                      {p.ready ? 'ready' : 'starting'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {pod && (
          <>
            {pod.containers.length > 1 && (
              <>
                <div className="label">Container</div>
                <div className="pick-list">
                  {pod.containers.map((c) => (
                    <div key={c} className={`pick ${c === container ? 'on' : ''}`} onClick={() => setContainer(c)} onDoubleClick={go}>
                      <span className="name">{c}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="label">Folder</div>
            <div className="row-fields">
              <div className="field">
                <input
                  className="text-input"
                  placeholder="Default: the workspace's projects folder"
                  value={folder}
                  spellCheck={false}
                  onChange={(e) => setFolder(e.target.value)}
                  onKeyDown={onEnter(go)}
                />
              </div>
              <Button variant="primary" isDisabled={busy || !pod} onPress={go}>
                Connect
              </Button>
            </div>
          </>
        )}

        <h2>Settings</h2>
        <div className="row-fields">
          <div className="field">
            <label>Path to oc</label>
            <input
              className="text-input"
              placeholder="Found automatically (PATH, Homebrew, ~/bin)"
              value={ocDraft}
              spellCheck={false}
              onChange={(e) => setOcDraft(e.target.value)}
              onBlur={() => updateSettings({ ocPath: ocDraft.trim() || undefined })}
            />
          </div>
          <Button
            variant="secondary"
            onPress={() => {
              updateSettings({ ocPath: ocDraft.trim() || undefined })
              loadProjects()
            }}
          >
            Refresh
          </Button>
        </div>
        <div className="help">
          Containers are reached with your <code>oc</code> login. If projects don't load, run <code>oc login</code> in a terminal first.
        </div>
      </div>
    </div>
  )
}
