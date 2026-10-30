import { useEffect, useState } from 'react'
import ConnectScreen from './components/ConnectScreen'
import Dialogs from './components/Dialogs'
import Workspace from './components/Workspace'
import { dirtyCount, quit } from './lib/actions'
import { inWails, invoke, on } from './lib/bridge'
import { installKeys } from './lib/keys'
import { applyTheme, loadSettings } from './lib/settings'
import * as S from './lib/store'

export default function App() {
  const [ready, setReady] = useState(false)
  // The workspace stays up while any project is open in it, the connect screen showing in it
  // for a project that isn't connected yet.
  const workspace = S.useStore((s) => S.isConnected(s.conn) || s.projects.length > 1)
  const fontFamily = S.useStore((s) => s.settings.fontFamily)

  useEffect(() => {
    loadSettings().then(() => {
      applyTheme()
      setReady(true)
    })
    const unsubTheme = S.subscribe(applyTheme)
    const uninstallKeys = installKeys()
    // The window asks before closing while anything is unsaved.
    let dirty = false
    const unsubDirty = S.subscribe(() => {
      const now = dirtyCount(true) > 0
      if (now !== dirty) {
        dirty = now
        invoke('SetDirty', now).catch(() => {})
      }
    })
    const offQuit = on('app:quit-requested', () => quit())
    // In a browser, closing the tab asks the same way.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    if (!inWails) window.addEventListener('beforeunload', beforeUnload)
    return () => {
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
      <Dialogs />
    </>
  )
}
