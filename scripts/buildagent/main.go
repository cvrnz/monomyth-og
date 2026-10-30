// Builds the container agent for linux/amd64 and linux/arm64 into agent/bin, where the Node
// server (server/src/remote.ts) uploads it from when connecting to a container:
//
//	go run ./scripts/buildagent
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	out := filepath.Join("agent", "bin")
	if err := os.MkdirAll(out, 0o755); err != nil {
		fail(err)
	}
	for _, arch := range []string{"amd64", "arm64"} {
		dest := filepath.Join(out, "agent-linux-"+arch)
		cmd := exec.Command("go", "build", "-trimpath", "-ldflags", "-s -w", "-o", dest, "./agent")
		cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH="+arch, "CGO_ENABLED=0")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			fail(fmt.Errorf("building agent for %s: %w", arch, err))
		}
		fmt.Println("built", dest)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
