//go:build linux

package main

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

// The user's login shell: $SHELL, else their /etc/passwd entry (`oc exec` doesn't set SHELL),
// else bash or sh.
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
	for _, s := range []string{"/bin/bash", "/usr/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(s); err == nil {
			return s
		}
	}
	return "sh"
}

type terminal struct {
	cmd *exec.Cmd
	pty *os.File
}

type terminals struct {
	a    *agent
	mu   sync.Mutex
	next int
	all  map[string]*terminal
}

func newTerminals(a *agent) *terminals {
	return &terminals{a: a, all: map[string]*terminal{}}
}

func (t *terminals) get(id string) (*terminal, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	term, ok := t.all[id]
	if !ok {
		return nil, fmt.Errorf("no terminal %s", id)
	}
	return term, nil
}

type openParams struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
	Cwd  string `json:"cwd"`
}

// A login shell on a new pty, so it gets the same prompt and profile as a normal session.
// Its output streams back as term.data events, and term.exit when it ends.
func (t *terminals) open(p openParams) (map[string]string, error) {
	shell := loginShell()
	cmd := exec.Command(shell, "-l")
	cmd.Dir = expandHome(p.Cwd)
	if info, err := os.Stat(cmd.Dir); p.Cwd == "" || err != nil || !info.IsDir() {
		cmd.Dir, _ = os.UserHomeDir()
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor", "SHELL="+shell, "TERM_PROGRAM=editor")
	size := &pty.Winsize{Cols: max(p.Cols, 20), Rows: max(p.Rows, 5)}
	f, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return nil, err
	}

	t.mu.Lock()
	t.next++
	id := strconv.Itoa(t.next)
	t.all[id] = &terminal{cmd: cmd, pty: f}
	t.mu.Unlock()

	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := f.Read(buf)
			if n > 0 {
				t.a.emit("term.data", map[string]string{"id": id, "data": base64.StdEncoding.EncodeToString(buf[:n])})
			}
			if err != nil {
				break
			}
		}
		code := 0
		if err := cmd.Wait(); err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				code = exit.ExitCode()
			}
		}
		f.Close()
		t.mu.Lock()
		delete(t.all, id)
		t.mu.Unlock()
		t.a.emit("term.exit", map[string]any{"id": id, "code": code})
	}()
	return map[string]string{"id": id, "shell": shell}, nil
}

func (t *terminals) input(p struct {
	ID   string `json:"id"`
	Data string `json:"data"`
}) (struct{}, error) {
	term, err := t.get(p.ID)
	if err != nil {
		return struct{}{}, err
	}
	data, err := base64.StdEncoding.DecodeString(p.Data)
	if err != nil {
		return struct{}{}, err
	}
	_, err = term.pty.Write(data)
	return struct{}{}, err
}

func (t *terminals) resize(p struct {
	ID   string `json:"id"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}) (struct{}, error) {
	term, err := t.get(p.ID)
	if err != nil {
		return struct{}{}, err
	}
	return struct{}{}, pty.Setsize(term.pty, &pty.Winsize{Cols: max(p.Cols, 2), Rows: max(p.Rows, 1)})
}

// Hang up on the shell, as closing a terminal window does.
func (t *terminals) close(p struct {
	ID string `json:"id"`
}) (struct{}, error) {
	term, err := t.get(p.ID)
	if err != nil {
		return struct{}{}, nil
	}
	if term.cmd.Process != nil {
		syscall.Kill(-term.cmd.Process.Pid, syscall.SIGHUP)
		term.cmd.Process.Signal(syscall.SIGHUP)
	}
	return struct{}{}, nil
}

func (t *terminals) closeAll() {
	t.mu.Lock()
	ids := make([]string, 0, len(t.all))
	for id := range t.all {
		ids = append(ids, id)
	}
	t.mu.Unlock()
	for _, id := range ids {
		t.close(struct {
			ID string `json:"id"`
		}{id})
	}
}
