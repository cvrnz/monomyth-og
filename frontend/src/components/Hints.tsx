// The line at the bottom of the explorer, Git and SQL tabs: the keys for the part that has the
// focus, and how to move to the next part. One line, cut short when it doesn't fit.
import { keyLabel } from '../lib/commands'

export default function Hints({ items }: { items: string[] }) {
  return (
    <div className="hints">
      <span className="hints-keys">{items.join('   ')}</span>
      <span className="hints-nav">{keyLabel('J')}/K next/previous pane</span>
    </div>
  )
}
