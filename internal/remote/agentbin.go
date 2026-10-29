package remote

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
)

// The agent binaries, built by `go run ./scripts/buildagent`.
//
//go:embed all:agentbin
var agentFS embed.FS

// The agent for a container architecture (as `uname -m` prints it), and a short hash of it
// that names the uploaded copy, so a new build is uploaded once and reused after.
func agentFor(machine string) ([]byte, string, error) {
	arch := map[string]string{"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}[machine]
	if arch == "" {
		return nil, "", fmt.Errorf("containers on %s aren't supported", machine)
	}
	data, err := agentFS.ReadFile("agentbin/agent-linux-" + arch)
	if err != nil {
		return nil, "", fmt.Errorf("this build has no agent for linux/%s; run `go run ./scripts/buildagent` and rebuild", arch)
	}
	sum := sha256.Sum256(data)
	return data, hex.EncodeToString(sum[:])[:12], nil
}
