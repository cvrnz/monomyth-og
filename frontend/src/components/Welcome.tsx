// The welcome screen, as in the nvim config: a random piece of ASCII art over the shortcuts
// to get started. The art is "Editor" in one of a few figlet fonts, a cow saying something,
// or one of the animations, drawn in the theme's colors in a random style. Tab, Space, Enter
// or a click shows another; typing (i, a, o) starts a new file in its place.
import { useEffect, useMemo, useRef, useState } from 'react'
import { newFileHere } from '../lib/actions'
import { keyLabel } from '../lib/commands'
import { register } from '../lib/panes'
import { currentTheme } from '../lib/settings'
import * as S from '../lib/store'

const tickMs = 60

// Animations: each a function from the tick (one every tickMs) to the frame's lines.
type Frame = (tick: number) => string[]

function seeded(seed: number) {
  return (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
}

// Stars twinkling over mountains, under the moon.
const mountains = [
  '            /\\                    /\\',
  '     /\\    /  \\        /\\        /  \\     /\\',
  '    /  \\  /    \\      /  \\  /\\  /    \\   /  \\',
  '___/    \\/      \\____/    \\/  \\/      \\_/    \\___',
]
const moon: [number, string][] = [
  [36, '.-.'],
  [35, '(   )'],
  [36, "`-'"],
]
const stars: { row: number; col: number }[] = []
{
  const random = seeded(7)
  while (stars.length < 20) {
    const row = random(5)
    const col = random(50)
    if (!(row <= 3 && col >= 32 && col <= 42)) stars.push({ row, col })
  }
}
const night: Frame = (tick) => {
  const rows = Array.from({ length: 5 }, () => Array<string>(50).fill(' '))
  moon.forEach(([col, piece], r) => [...piece].forEach((ch, i) => (rows[r][col + i] = ch)))
  const glyphs = ['·', '·', '+', '*', '✦', ' ']
  stars.forEach((s, i) => {
    const phase = (Math.floor(tick / 4) + i * 5) % 17
    rows[s.row][s.col] = glyphs[phase < glyphs.length ? phase : 0]
  })
  return [...rows.map((r) => r.join('')), ...mountains]
}

// A boat on rolling waves.
const boatShape = ['    |\\', '    | \\', '    |  \\', '  __|___\\_', '  \\______/']
const boat: Frame = (tick) => {
  const x = 20 + Math.floor(3 * Math.sin(tick / 25))
  const bob = Math.sin(tick / 6) > 0 ? 0 : 1
  const lines: string[] = []
  for (let i = 0; i < bob; i++) lines.push('')
  for (const part of boatShape) lines.push(' '.repeat(x) + part)
  for (let i = bob; i <= 0; i++) lines.push('')
  for (let r = 0; r < 4; r++) {
    let row = ''
    for (let c = 0; c < 50; c++) {
      const v = Math.sin(c * 0.25 - tick * 0.15 + r * 1.3) + 0.4 * Math.sin(c * 0.6 + tick * 0.1)
      row += v > 0.9 ? '~' : v > 0.3 ? '-' : v > -0.3 ? '.' : ' '
    }
    lines.push(row)
  }
  return lines
}

// Digits raining down.
const drops: { col: number; speed: number; offset: number }[] = []
for (let c = 0; c < 46; c += 2) drops.push({ col: c, speed: 0.25 + ((c * 37) % 10) / 20, offset: (c * 53) % 17 })
const rain: Frame = (tick) => {
  const rows = Array.from({ length: 9 }, () => Array<string>(46).fill(' '))
  drops.forEach((d, i) => {
    const head = (Math.floor(tick * d.speed + d.offset) % 15) + 1
    for (let k = 0; k < 5; k++) {
      const r = head - k
      if (r >= 1 && r <= 9) rows[r - 1][d.col] = k === 0 ? String((i + Math.floor(tick / 3)) % 2) : k < 3 ? ':' : '.'
    }
  })
  return rows.map((r) => r.join(''))
}

// A cup of coffee, steaming.
const steam = [
  ['  (  )  (', '   )  (  )', '  (  )  ('],
  ['   )  (  )', '  (  )  (', '   )  (  )'],
]
const cup = [' .-----------.', ' |           |__', ' |           |  |', ' |           |__|', '  \\_________/', "   `-------'"]
const coffee: Frame = (tick) => [...steam[Math.floor(tick / 8) % 2].map((l) => '  ' + l), ...cup]

// A rocket, engine flickering.
const rocketShape = ['      /\\', '     /  \\', '    |    |', '    | () |', '    |    |', '   /|    |\\', '  /_|____|_\\']
const flames = [
  ['     \\/\\/', '      \\/'],
  ['     /\\/\\', '     \\  /'],
  ['     |/\\|', '      ||'],
]
const rocket: Frame = (tick) => [...rocketShape, ...flames[Math.floor(tick / 3) % flames.length]]

const animations = [night, boat, rain, coffee, rocket]

// "Editor" in a few figlet fonts.
const banners = [
  [' _____    _ _ _             ', '| ____|__| (_) |_ ___  _ __ ', "|  _| / _` | | __/ _ \\| '__|", '| |__| (_| | | || (_) | |   ', '|_____\\__,_|_|\\__\\___/|_|   '],
  ['    ______    ___ __            ', '   / ____/___/ (_) /_____  _____', '  / __/ / __  / / __/ __ \\/ ___/', ' / /___/ /_/ / / /_/ /_/ / /    ', '/_____/\\__,_/_/\\__/\\____/_/     '],
  [' ___    _ _ _           ', '| __|__| (_) |_ ___ _ _ ', "| _|/ _` | |  _/ _ \\ '_|", '|___\\__,_|_|\\__\\___/_|  '],
  [
    '███████╗██████╗ ██╗████████╗ ██████╗ ██████╗ ',
    '██╔════╝██╔══██╗██║╚══██╔══╝██╔═══██╗██╔══██╗',
    '█████╗  ██║  ██║██║   ██║   ██║   ██║██████╔╝',
    '██╔══╝  ██║  ██║██║   ██║   ██║   ██║██╔══██╗',
    '███████╗██████╔╝██║   ██║   ╚██████╔╝██║  ██║',
    '╚══════╝╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝',
  ],
  ['  ___  ___  _  _____  ___   ___ ', ' | __||   \\| ||_   _|/ _ \\ | _ \\', ' | _| | |) | |  | | | (_) ||   /', ' |___||___/|_|  |_|  \\___/ |_|_\\'],
]

const creatures = [
  ['        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'],
  ['     \\', '      \\   ,___,', '          [O.o]', '          /)__)', '       ----"-"----'],
  ['     \\', '      \\    /\\_/\\', '          ( o.o )', '           > ^ <'],
]

function sayings(): string[] {
  const k = (x: string) => keyLabel(x)
  return [
    'Moo.',
    'Hello there!',
    'Happy hacking!',
    'What are we building today?',
    'Have you tried turning it off and on again?',
    'It works on my machine.',
    'Ship it!',
    'Coffee first.',
    'Fewer bugs than yesterday.',
    'You look nice today.',
    `Press ${k('P')} to find any file.`,
    `Press ${k('E')} for the explorer.`,
    `Press ${k('T')} for a terminal.`,
    'Press : for every command.',
    `Press ${k('G')} to see what changed.`,
    'Press Tab for another one!',
  ]
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line)
      line = word
    } else line = line ? line + ' ' + word : word
  }
  if (line) lines.push(line)
  return lines
}

// A creature with a speech bubble, cowsay-style.
function cow(saying: string, creature: string[]): string[] {
  const lines = wrap(saying, 30)
  const w = Math.max(...lines.map((l) => l.length))
  const out = [' ' + '_'.repeat(w + 2)]
  lines.forEach((l, i) => {
    const [a, b] = lines.length === 1 ? ['<', '>'] : i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|']
    out.push(`${a} ${l.padEnd(w)} ${b}`)
  })
  out.push(' ' + '-'.repeat(w + 2))
  return [...out, ...creature]
}

type Style = 'plain' | 'solid' | 'gradient' | 'rainbow'
type Art = { lines: string[]; frame?: Frame; width: number; height: number; style: Style; color: number; offset: number }

const width = (lines: string[]) => Math.max(0, ...lines.map((l) => [...l].length))

function pick(maxWidth: number, maxHeight: number): Art | null {
  for (let i = 0; i < 30; i++) {
    const roll = Math.random()
    let lines: string[]
    let frame: Frame | undefined
    if (roll < 0.4) lines = banners[Math.floor(Math.random() * banners.length)]
    else if (roll < 0.75) {
      const all = sayings()
      lines = cow(all[Math.floor(Math.random() * all.length)], creatures[Math.floor(Math.random() * creatures.length)])
    } else {
      frame = animations[Math.floor(Math.random() * animations.length)]
      lines = frame(0)
    }
    if (lines.length <= maxHeight && width(lines) <= maxWidth) {
      const styles: Style[] = ['plain', 'plain', 'solid', 'gradient', 'rainbow']
      return {
        lines,
        frame,
        width: width(lines),
        height: lines.length,
        style: styles[Math.floor(Math.random() * styles.length)],
        color: Math.floor(Math.random() * 7),
        offset: Math.floor(Math.random() * 12),
      }
    }
  }
  return null
}

// The theme's colors, in hue order, for the colorful styles.
function palette(): string[] {
  const p = currentTheme()
  return [p.red, p.orange, p.yellow, p.green, p.cyan, p.blue, p.purple]
}

type Run = { text: string; color: string }

function paint(line: string, row: number, art: Art, tick: number, colors: string[], shine: number | null): Run[] {
  const chars = [...line]
  const dim = 'var(--dim)'
  const color = (col: number): string => {
    if (shine !== null && col >= shine - row && col < shine - row + 8) return 'var(--fg)'
    switch (art.style) {
      case 'solid':
        return colors[art.color % colors.length]
      case 'gradient': {
        const span = Math.min(colors.length, art.height)
        return colors[(art.offset + Math.floor((row * span) / art.height)) % colors.length]
      }
      case 'rainbow':
        return colors[((Math.floor((col + row + art.offset - tick / 2) / 3) % colors.length) + colors.length) % colors.length]
      default:
        return dim
    }
  }
  const runs: Run[] = []
  chars.forEach((ch, col) => {
    const c = color(col)
    const last = runs[runs.length - 1]
    if (last && last.color === c) last.text += ch
    else runs.push({ text: ch, color: c })
  })
  return runs
}

export default function Welcome({ id, active }: { id: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ cols: 0, rows: 0 })
  const [art, setArt] = useState<Art | null>(null)
  const [tick, setTick] = useState(0)
  const fontSize = S.useStore((s) => s.settings.fontSize)
  const themeName = S.useStore((s) => s.previewTheme ?? s.settings.theme)
  const platform = S.useStore((s) => s.platform)

  const items = useMemo(
    () => [
      ['Explorer', keyLabel('E')],
      ['Find files and text', keyLabel('P')],
      ['Terminal', keyLabel('T')],
      ['Split terminal', keyLabel('\\')],
      ['New tab', keyLabel('N')],
      ['Switch tabs', `${keyLabel('H')}  ${keyLabel('L')}`],
      ['Source control', keyLabel('G')],
      ['Close', keyLabel('W')],
      ['Command palette', ':'],
    ],
    // The keys read ⌘ or Ctrl depending on the platform.
    [platform],
  )

  // Everything has a fixed place for a given size, so new art never moves the shortcuts: the
  // art gets an area of its own (up to 18 rows, less in a short window, none in a tiny one).
  const below = 6 + items.length * 2 - 1 + 5
  const area = (() => {
    const a = Math.min(18, size.rows - below - 2)
    return a >= 4 ? a : 0
  })()
  const maxWidth = size.cols - 4

  useEffect(() => {
    const el = box.current!
    const measure = () => {
      const lh = fontSize * 1.2
      const cw = fontSize * 0.6
      setSize({ cols: Math.floor(el.clientWidth / cw), rows: Math.floor(el.clientHeight / lh) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fontSize])

  useEffect(() => {
    if (area > 0 && (!art || art.height > area || art.width > maxWidth)) {
      setArt(pick(maxWidth, area))
      setTick(0)
    }
  }, [area, maxWidth, art])

  // Animate only while showing.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setTick((n) => n + 1), tickMs)
    return () => clearInterval(t)
  }, [active])

  useEffect(() => register(id, { focus: () => box.current?.focus() }), [id])
  useEffect(() => {
    if (active) requestAnimationFrame(() => box.current?.focus())
  }, [active])
  useEffect(() => {
    S.setPaneStatus(id, { mode: 'normal', items: [] })
    return () =>
      S.set((s) => {
        const status = { ...s.status }
        delete status[id]
        return { status }
      })
  }, [id])

  const another = () => {
    setArt(area > 0 ? pick(maxWidth, area) : null)
    setTick(0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Tab' || e.key === ' ' || e.key === 'Enter') another()
    else if ('iaoIAO'.includes(e.key) && e.key.length === 1) newFileHere()
    else if (e.key === ':') S.set({ palette: { mode: 'commands' } })
    else return
    e.preventDefault()
  }

  const shown = area > 0 ? art : null
  // Recomputed when the theme changes.
  const colors = useMemo(() => palette(), [themeName])
  let lines: Run[][] = []
  if (shown) {
    const artLines = shown.frame ? shown.frame(tick) : shown.lines
    // The art is revealed left to right; then a light sweeps across plain pieces now and then.
    const reveal = tick * 4
    const revealed = reveal >= shown.width + shown.height
    const sweep = revealed && shown.style === 'plain' && !shown.frame ? (((tick - 30) % 80) + 80) % 80 * 2 - 10 : null
    lines = artLines.map((line, r) => {
      const visible = revealed ? line : [...line].slice(0, Math.max(0, reveal - r)).join('')
      return paint(visible, r, shown, tick, colors, sweep)
    })
  }

  const lh = '1.2em'
  return (
    <div
      ref={box}
      className="welcome"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        e.preventDefault()
        box.current?.focus()
        another()
      }}
      style={{ fontSize, lineHeight: lh }}
    >
      {area > 0 && (
        <div className="art" style={{ height: `calc(${area} * ${lh})` }}>
          <pre>
            {lines.map((runs, i) => (
              <div key={i} style={{ height: lh }}>
                {runs.map((r, j) => (
                  <span key={j} style={{ color: r.color }}>
                    {r.text}
                  </span>
                ))}
              </div>
            ))}
          </pre>
        </div>
      )}
      <div className="shortcuts">
        {items.map(([label, key]) => (
          <div key={label} style={{ display: 'contents' }}>
            <span>{label}</span>
            <span className="k">{key}</span>
          </div>
        ))}
      </div>
      <div className="hint">
        <b>Tab</b>  another one
      </div>
      <div className="dim" style={{ marginTop: '1.2em' }}>
        Editor 0.1.0
      </div>
    </div>
  )
}
