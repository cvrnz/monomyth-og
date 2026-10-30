// The agent for this computer: the same methods and events as the container agent
// (internal/agent), answered in this process.
import * as files from './files.ts'
import * as scm from './git.ts'
import * as search from './search.ts'
import { Terminals } from './term.ts'

type Handler = (params: any) => unknown

export class LocalAgent {
  private terms: Terminals
  private handlers: Record<string, Handler>

  constructor(emit: (event: string, params: unknown) => void) {
    this.terms = new Terminals(emit)
    this.handlers = {
      hello: files.hello,
      'fs.list': files.list,
      'fs.read': files.read,
      'fs.write': files.write,
      'fs.create': files.create,
      'fs.rename': files.rename,
      'fs.delete': files.remove,
      'fs.stat': files.stat,
      'fs.files': search.files,
      'fs.grep': search.grep,
      'scm.repos': scm.repos,
      'scm.changes': scm.scmChanges,
      'scm.versions': scm.versions,
      'scm.fetch': scm.fetch,
      'scm.sync': scm.sync,
      'term.open': (p) => this.terms.open(p),
      'term.input': (p) => this.terms.input(p),
      'term.resize': (p) => this.terms.resize(p),
      'term.close': (p) => this.terms.close(p),
    }
  }

  // Params and the result are JSON, as they are over the wire to a container.
  async call(method: string, params: string): Promise<string> {
    const handler = this.handlers[method]
    if (!handler) throw new Error('unknown method ' + method)
    const result = await handler(JSON.parse(params || 'null') ?? {})
    return JSON.stringify(result ?? null)
  }

  // Hangs up its shells.
  async close() {
    this.terms.closeAll()
  }
}
