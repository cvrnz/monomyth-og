// Splitting a script into statements where the database won't do it itself.

// SQLite statements, split on ; outside strings, quoted names and comments. A CREATE TRIGGER's
// body (BEGIN ... END, with CASE ... END inside) stays in one piece. Statements that are only
// comments or blank are dropped.
export function splitSqlite(text: string): string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let words: string[] = []
  let meaningful = false
  const flush = (end: number) => {
    const stmt = text.slice(start, end).trim()
    if (meaningful && stmt) out.push(stmt)
    start = end + 1
    depth = 0
    words = []
    meaningful = false
  }
  const trigger = () => words[0] === 'CREATE' && (words[1] === 'TRIGGER' || (/^TEMP(ORARY)?$/.test(words[1] ?? '') && words[2] === 'TRIGGER'))
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i)
      i = nl < 0 ? text.length : nl
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let j = i + 1
      while (j < text.length) {
        if (text[j] === close) {
          if (close !== ']' && text[j + 1] === close) j += 2
          else break
        } else j++
      }
      i = j
      meaningful = true
    } else if (c === ';') {
      if (depth === 0) flush(i)
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j + 1 < text.length && /[A-Za-z0-9_$]/.test(text[j + 1])) j++
      const word = text.slice(i, j + 1).toUpperCase()
      if (words.length < 3) words.push(word)
      if (trigger()) {
        if (word === 'BEGIN' || word === 'CASE') depth++
        else if (word === 'END' && depth > 0) depth--
      }
      meaningful = true
      i = j
    } else if (!/\s/.test(c)) {
      meaningful = true
    }
  }
  flush(text.length)
  return out
}

// SQL Server batches, split on lines that are only GO (as sqlcmd and SSMS do).
export function splitBatches(text: string): string[] {
  const out: string[] = []
  let batch: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*go\s*(--.*)?$/i.test(line)) {
      out.push(batch.join('\n'))
      batch = []
    } else batch.push(line)
  }
  out.push(batch.join('\n'))
  return out.filter((b) => b.trim())
}
