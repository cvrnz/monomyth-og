//go:build windows

package agent

import (
	"context"
	"os"
	"os/exec"
	"syscall"

	"github.com/aymanbagabas/go-pty"
)

// The app has no console, so without this every git or rg it runs would flash a console window.
func hide(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd
}

func command(name string, args ...string) *exec.Cmd { return hide(exec.Command(name, args...)) }

func commandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return hide(exec.CommandContext(ctx, name, args...))
}

// PowerShell 7 if it's installed, else Windows PowerShell, else cmd.
func shellCommand() (string, []string) {
	for _, name := range []string{"pwsh.exe", "powershell.exe"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, []string{"-NoLogo"}
		}
	}
	if c := os.Getenv("COMSPEC"); c != "" {
		return c, nil
	}
	return "cmd.exe", nil
}

func loginShell() string {
	s, _ := shellCommand()
	return s
}

func hangUp(cmd *pty.Cmd) {
	if cmd.Process != nil {
		cmd.Process.Kill()
	}
}
