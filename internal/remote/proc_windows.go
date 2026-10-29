//go:build windows

package remote

import (
	"os/exec"
	"syscall"
)

// Without this, every oc command flashes a console window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
