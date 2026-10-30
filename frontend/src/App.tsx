import { useEffect, useState } from 'react'
import ConnectScreen from './components/ConnectScreen'
import Dialogs from './components/Dialogs'
import Workspace from './components/Workspace'
import { dirtyCount } from './lib/actions'
import { installKeys } from './lib/keys'
import { restoreSession } from './lib/session'
import { applyTheme, loadSettings } from './lib/settings'
import * as S from './lib/store'

export default function App() {
  const [ready, setReady] = useState(false)
  // The workspace stays up while any project is open in it, the connect screen showing in it
  // for a project that isn't connected yet.
  const workspace = S.useStore((s) => S.isConnected(s.conn) || s.projects.length > 1)
  const fontFamily = S.useStore((s) => s.settings.fontFamily)

  useEffect(() => {
    // Only the latest run of this effect (React runs it twice in development) sets up.
    let live = true
    let stopSession = () => {}
    loadSettings().then(() => {
      if (!live) return
      applyTheme()
      stopSession = restoreSession()
      setReady(true)
    })
    const unsubTheme = S.subscribe(applyTheme)
    const uninstallKeys = installKeys()
    // Closing the window asks first while anything is unsaved.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyCount(true) > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      live = false
      stopSession()
      unsubTheme()
      uninstallKeys()
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
