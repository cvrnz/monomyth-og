// Loading and saving settings (the Go side stores them as JSON in the user's config folder),
// and applying the theme everywhere.
import { invoke } from './bridge'
import { toast } from './dialogs'
import { monaco } from './monaco'
import * as S from './store'
import { applyChrome, monacoTheme, type Palette, parseTheme, setUserThemes, themeNamed } from './themes'

export async function loadSettings() {
  const [raw, platform] = await Promise.all([invoke<string>('Settings').catch(() => '{}'), invoke<string>('Platform').catch(() => 'darwin')])
  let saved: Partial<S.Settings> = {}
  try {
    saved = JSON.parse(raw)
  } catch {
    // Unreadable settings start over from the defaults.
  }
  S.set({ platform, settings: { ...S.defaultSettings, ...saved } })
  document.documentElement.dataset.platform = platform
  await loadUserThemes()
}

// Resolves once saved (or failed to).
export function updateSettings(patch: Partial<S.Settings>): Promise<void> {
  const settings = { ...S.get().settings, ...patch }
  S.set({ settings })
  return invoke('SaveSettings', JSON.stringify(settings)).then(
    () => {},
    () => {},
  )
}

// The theme being shown: the one being previewed in the picker, or the saved one.
export function currentTheme() {
  const s = S.get()
  return themeNamed(s.previewTheme ?? s.settings.theme)
}

let applied = ''
export function applyTheme() {
  const p = currentTheme()
  if (p.name === applied) return
  applied = p.name
  applyChrome(p)
  monaco.editor.setTheme(p.name)
}

// (Re)reads the user's themes from the themes folder next to the settings, so a changed file
// shows the next time Themes is opened.
export async function loadUserThemes() {
  const files = await invoke<{ file: string; text: string }[]>('Themes').catch(() => [])
  const list: Palette[] = []
  for (const f of files ?? []) {
    const t = parseTheme(f.file, f.text)
    if (typeof t === 'string') {
      toast(t, 'error')
      continue
    }
    monaco.editor.defineTheme(t.name, monacoTheme(t))
    list.push(t)
  }
  setUserThemes(list)
  applied = ''
  applyTheme()
}
