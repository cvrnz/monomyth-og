import { useEffect, useState } from 'react'
import ConnectScreen from './components/ConnectScreen'
import Dialogs from './components/Dialogs'
import Workspace from './components/Workspace'
import { dirtyCount, quit } from './lib/actions'
import { invoke, on } from './lib/bridge'
import { installKeys } from './lib/keys'
import { restoreSession } from './lib/session'
import { applyTheme, loadSettings } from './lib/settings'
import { drag, loadInApp, windowMenu, windowZoom } from './lib/window'
import * as S from './lib/store'

export default function App() {
  const [ready, setReady] = useState(false)
  // In the macOS app, whose window has no title bar.
  const [desktop, setDesktop] = useState(false)
  // The workspace stays up while any project is open in it, the connect screen showing in it
  // for a project that isn't connected yet.
  const workspace = S.useStore((s) => S.isConnected(s.conn) || s.projects.length > 1)
  const fontFamily = S.useStore((s) => s.settings.fontFamily)

  useEffect(() => {
    // Only the latest run of this effect (React runs it twice in development) sets up.
    let live = true
    let stopSession = () => {}
    Promise.all([loadSettings(), loadInApp()]).then(([, inApp]) => {
      if (!live) return
      setDesktop(inApp)
      applyTheme()
      stopSession = restoreSession()
      setReady(true)
    })
    const unsubTheme = S.subscribe(applyTheme)
    const uninstallKeys = installKeys()
    // Closing the window asks first while anything is unsaved: in a browser through
    // beforeunload, in the macOS app by quitting through the page (app:quit-requested). The app
    // is told whether anything is unsaved, so it knows whether to wait for an answer.
    let dirty = false
    const unsubDirty = S.subscribe(() => {
      const now = dirtyCount(true) > 0
      if (now !== dirty) {
        dirty = now
        invoke('SetDirty', now).catch(() => {})
      }
    })
    const offQuit = on('app:quit-requested', () => quit())
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      live = false
      stopSession()
      unsubTheme()
      uninstallKeys()
      unsubDirty()
      offQuit()
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--mono', fontFamily)
  }, [fontFamily])

  if (!ready) return null
  return (
    <>
      {workspace ? <Workspace /> : <ConnectScreen />}
      {/* The connect screen on its own has no top row: a strip there stands in for it. */}
      {desktop && !workspace && (
        <div className={`window-drag ${drag}`} onContextMenu={windowMenu} onDoubleClick={windowZoom} />
      )}
      <Dialogs />
    </>
  )
}
