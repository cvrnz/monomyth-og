//go:build !windows

package agent

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"

	"github.com/aymanbagabas/go-pty"
)

func command(name string, args ...string) *exec.Cmd { return exec.Command(name, args...) }

func commandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

// The user's login shell, started as one (-l) so it gets the same prompt and profile as a
// normal session: $SHELL, else their /etc/passwd entry (`oc exec` doesn't set SHELL), else
// zsh on macOS, bash or sh elsewhere.
func shellCommand() (string, []string) {
	return loginShell(), []string{"-l"}
}

func loginShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	uid := strconv.Itoa(os.Getuid())
	if f, err := os.Open("/etc/passwd"); err == nil {
		defer f.Close()
		scan := bufio.NewScanner(f)
		for scan.Scan() {
			fields := strings.Split(scan.Text(), ":")
			if len(fields) >= 7 && fields[2] == uid && fields[6] != "" {
				if _, err := os.Stat(fields[6]); err == nil {
					return fields[6]
				}
			}
		}
	}
	candidates := []string{"/bin/bash", "/usr/bin/bash", "/bin/sh"}
	if runtime.GOOS == "darwin" {
		candidates = append([]string{"/bin/zsh"}, candidates...)
	}
	for _, s := range candidates {
		if _, err := os.Stat(s); err == nil {
			return s
		}
	}
	return "sh"
}

// Hang up on the shell, as closing a terminal window does: its whole process group.
func hangUp(cmd *pty.Cmd) {
	if cmd.Process == nil {
		return
	}
	syscall.Kill(-cmd.Process.Pid, syscall.SIGHUP)
	cmd.Process.Signal(syscall.SIGHUP)
}
