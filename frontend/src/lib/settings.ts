// Loading and saving settings (the Go side stores them as JSON in the user's config folder),
// and applying the theme everywhere.
import { invoke } from './bridge'
import { monaco } from './monaco'
import * as S from './store'
import { applyChrome, themeNamed } from './themes'

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
}

export function updateSettings(patch: Partial<S.Settings>) {
  const settings = { ...S.get().settings, ...patch }
  S.set({ settings })
  invoke('SaveSettings', JSON.stringify(settings)).catch(() => {})
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
