// The color schemes from the nvim config, as palettes. Each palette themes everything: the
// chrome (HeroUI's variables), Monaco, and the terminals. Like the nvim config, the chrome
// takes the theme's neutral colors: text, comment (dim) and cursor-line (raised) on its
// background.
import type { ITheme } from '@xterm/xterm'
import type * as Monaco from 'monaco-editor'

export type Palette = {
  name: string
  bg: string
  dark: string // floating windows, popups
  raised: string // cursor line, selected tab
  selection: string
  fg: string
  dim: string
  red: string
  green: string
  yellow: string
  orange: string
  blue: string
  purple: string
  cyan: string
}

export const themes: Palette[] = [
  { name: 'onedark', bg: '#282c34', dark: '#21252b', raised: '#31353f', selection: '#3e4452', fg: '#abb2bf', dim: '#5c6370', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', orange: '#d19a66', blue: '#61afef', purple: '#c678dd', cyan: '#56b6c2' },
  { name: 'catppuccin', bg: '#1e1e2e', dark: '#181825', raised: '#2a2b3c', selection: '#45475a', fg: '#cdd6f4', dim: '#6c7086', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', orange: '#fab387', blue: '#89b4fa', purple: '#cba6f7', cyan: '#94e2d5' },
  { name: 'tokyonight', bg: '#1a1b26', dark: '#16161e', raised: '#292e42', selection: '#283457', fg: '#c0caf5', dim: '#565f89', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', orange: '#ff9e64', blue: '#7aa2f7', purple: '#bb9af7', cyan: '#7dcfff' },
  { name: 'rose-pine', bg: '#191724', dark: '#1f1d2e', raised: '#21202e', selection: '#403d52', fg: '#e0def4', dim: '#6e6a86', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', orange: '#ebbcba', blue: '#9ccfd8', purple: '#c4a7e7', cyan: '#9ccfd8' },
  { name: 'kanagawa', bg: '#1f1f28', dark: '#16161d', raised: '#2a2a37', selection: '#2d4f67', fg: '#dcd7ba', dim: '#727169', red: '#e46876', green: '#98bb6c', yellow: '#e6c384', orange: '#ffa066', blue: '#7e9cd8', purple: '#957fb8', cyan: '#7fb4ca' },
  { name: 'gruvbox', bg: '#282828', dark: '#1d2021', raised: '#3c3836', selection: '#504945', fg: '#ebdbb2', dim: '#928374', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', orange: '#fe8019', blue: '#83a598', purple: '#d3869b', cyan: '#8ec07c' },
  { name: 'nightfox', bg: '#192330', dark: '#131a24', raised: '#212e3f', selection: '#2b3b51', fg: '#cdcecf', dim: '#738091', red: '#c94f6d', green: '#81b29a', yellow: '#dbc074', orange: '#f4a261', blue: '#719cd6', purple: '#9d79d6', cyan: '#63cdcf' },
  { name: 'everforest', bg: '#2d353b', dark: '#232a2e', raised: '#343f44', selection: '#475258', fg: '#d3c6aa', dim: '#859289', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', orange: '#e69875', blue: '#7fbbb3', purple: '#d699b6', cyan: '#83c092' },
]

export function themeNamed(name: string | undefined): Palette {
  return themes.find((t) => t.name === name) ?? themes[0]
}

function mix(a: string, b: string, amount: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (p: number, shift: number) => (p >> shift) & 255
  const out = [16, 8, 0].map((s) => Math.round(ch(pa, s) * (1 - amount) + ch(pb, s) * amount))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

// The chrome: HeroUI's variables and our own (--bg, --fg, --dim, --raised, ...).
export function applyChrome(p: Palette) {
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--bg-dark': p.dark,
    '--fg': p.fg,
    '--dim': p.dim,
    '--raised': p.raised,
    '--selection': p.selection,
    '--red': p.red,
    '--green': p.green,
    '--yellow': p.yellow,
    '--orange': p.orange,
    '--blue': p.blue,
    '--purple': p.purple,
    '--cyan': p.cyan,
    '--background': p.bg,
    '--foreground': p.fg,
    '--surface': p.dark,
    '--surface-foreground': p.fg,
    '--surface-secondary': p.raised,
    '--surface-tertiary': p.selection,
    '--overlay': p.dark,
    '--overlay-foreground': p.fg,
    '--muted': p.dim,
    '--default': p.raised,
    '--default-foreground': p.fg,
    '--accent': p.blue,
    '--accent-foreground': p.bg,
    '--success': p.green,
    '--success-foreground': p.bg,
    '--warning': p.yellow,
    '--warning-foreground': p.bg,
    '--danger': p.red,
    '--danger-foreground': p.bg,
    '--border': mix(p.bg, p.fg, 0.14),
    '--separator': mix(p.bg, p.fg, 0.1),
    '--focus': p.blue,
    '--field-background': p.raised,
    '--field-foreground': p.fg,
    '--field-placeholder': p.dim,
    '--segment': p.selection,
    '--segment-foreground': p.fg,
    '--backdrop': 'rgba(0, 0, 0, 0.45)',
  }
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.style.colorScheme = 'dark'
}

const strip = (c: string) => c.slice(1)

export function monacoTheme(p: Palette): Monaco.editor.IStandaloneThemeData {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: strip(p.fg) },
      { token: 'comment', foreground: strip(p.dim), fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(p.purple) },
      { token: 'keyword.flow', foreground: strip(p.purple) },
      { token: 'storage', foreground: strip(p.purple) },
      { token: 'string', foreground: strip(p.green) },
      { token: 'string.escape', foreground: strip(p.cyan) },
      { token: 'regexp', foreground: strip(p.cyan) },
      { token: 'number', foreground: strip(p.orange) },
      { token: 'constant', foreground: strip(p.orange) },
      { token: 'type', foreground: strip(p.yellow) },
      { token: 'type.identifier', foreground: strip(p.yellow) },
      { token: 'identifier', foreground: strip(p.fg) },
      { token: 'function', foreground: strip(p.blue) },
      { token: 'variable', foreground: strip(p.red) },
      { token: 'variable.predefined', foreground: strip(p.cyan) },
      { token: 'tag', foreground: strip(p.red) },
      { token: 'attribute.name', foreground: strip(p.orange) },
      { token: 'attribute.value', foreground: strip(p.green) },
      { token: 'delimiter', foreground: strip(p.fg) },
      { token: 'operator', foreground: strip(p.cyan) },
      { token: 'key', foreground: strip(p.red) },
      { token: 'string.key.json', foreground: strip(p.red) },
      { token: 'string.value.json', foreground: strip(p.green) },
      { token: 'metatag', foreground: strip(p.red) },
      { token: 'annotation', foreground: strip(p.yellow) },
      { token: 'markup.heading', foreground: strip(p.red), fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
      'editorLineNumber.foreground': p.dim,
      'editorLineNumber.activeForeground': p.fg,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': p.selection,
      'editor.inactiveSelectionBackground': p.selection + '99',
      'editorCursor.foreground': p.fg,
      'editorWhitespace.foreground': p.raised,
      'editorIndentGuide.background1': p.raised,
      'editorIndentGuide.activeBackground1': p.selection,
      'editorWidget.background': p.dark,
      'editorWidget.border': p.raised,
      'editorSuggestWidget.background': p.dark,
      'editorSuggestWidget.selectedBackground': p.raised,
      'editorHoverWidget.background': p.dark,
      'input.background': p.raised,
      'scrollbarSlider.background': p.fg + '22',
      'scrollbarSlider.hoverBackground': p.fg + '33',
      'scrollbarSlider.activeBackground': p.fg + '44',
      'scrollbar.shadow': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'diffEditor.insertedTextBackground': p.green + '33',
      'diffEditor.removedTextBackground': p.red + '33',
      'diffEditor.insertedLineBackground': p.green + '1a',
      'diffEditor.removedLineBackground': p.red + '1a',
      'diffEditor.diagonalFill': p.raised,
      'diffEditorGutter.insertedLineBackground': p.green + '1a',
      'diffEditorGutter.removedLineBackground': p.red + '1a',
      'diffEditor.border': p.raised,
      'focusBorder': '#00000000',
    },
  }
}

export function xtermTheme(p: Palette): ITheme {
  return {
    background: p.bg,
    foreground: p.fg,
    cursor: p.fg,
    cursorAccent: p.bg,
    selectionBackground: p.selection,
    black: p.dark,
    red: p.red,
    green: p.green,
    yellow: p.yellow,
    blue: p.blue,
    magenta: p.purple,
    cyan: p.cyan,
    white: p.fg,
    brightBlack: p.dim,
    brightRed: p.red,
    brightGreen: p.green,
    brightYellow: p.yellow,
    brightBlue: p.blue,
    brightMagenta: p.purple,
    brightCyan: p.cyan,
    brightWhite: mix(p.fg, '#ffffff', 0.4),
  }
}
