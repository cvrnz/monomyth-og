//go:build !windows

package remote

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}
