//go:build linux

// The agent binary runs inside the container, started by the server over `oc exec -i`. It reads
// requests from stdin and writes responses and events to stdout (see internal/agent), and
// exits when stdin closes, which is what happens when the server disconnects.
package main

import (
	"fmt"
	"os"

	"editor/internal/agent"
)

func main() {
	if err := agent.Serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "agent:", err)
	}
}
