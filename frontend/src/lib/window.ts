// The macOS app's window, which has no title bar: the top row (Workspace's projects and tabs,
// or a strip above the connect screen) drags it, double-clicking its background zooms the
// window to fill the screen (and back), and right-clicking it shows a menu to close, minimize
// or go full screen. Nothing of this happens in a browser.
import type { MouseEvent } from 'react'
import { invoke } from './bridge'

// Electrobun's classes for a page's drag regions.
export const drag = 'electrobun-webkit-app-region-drag'
export const noDrag = 'electrobun-webkit-app-region-no-drag'

let inApp = false

// Whether the page is in the macOS app, asked once at startup.
export async function loadInApp(): Promise<boolean> {
  inApp = await invoke<boolean>('Desktop').catch(() => false)
  if (inApp) window.addEventListener('mousedown', onlyLeftDrags, true)
  return inApp
}

// Electrobun's page script starts moving the window on any mouse button pressed on the drag
// region, and stops on its release. A right-click (or Ctrl-click) opens the window menu, which
// takes that release, so the window would follow the mouse after the menu closes. Those presses
// stop here, before they reach the script (it listens on the document).
function onlyLeftDrags(e: globalThis.MouseEvent) {
  if (e.button === 0 && !e.ctrlKey) return
  const target = e.target as Element
  if (target.closest?.(`.${drag}`) && !target.closest(`.${noDrag}`)) e.stopPropagation()
}

// Whether an event on the top row is on its background, not a tab or project.
const onBackground = (e: MouseEvent) => inApp && !(e.target as Element).closest(`.${noDrag}`)

export function windowMenu(e: MouseEvent) {
  if (!onBackground(e)) return
  e.preventDefault()
  invoke('Window', 'menu').catch(() => {})
}

export function windowZoom(e: MouseEvent) {
  if (!onBackground(e)) return
  invoke('Window', 'zoom').catch(() => {})
}
