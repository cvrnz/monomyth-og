package agent

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
)

type terminal struct {
	cmd *pty.Cmd
	pty pty.Pty
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

// The user's shell on a new pseudo-terminal (a pty, or ConPTY on Windows). Its output streams
// back as term.data events, and term.exit when it ends.
func (t *terminals) open(p openParams) (map[string]string, error) {
	shell, args := shellCommand()
	p.Cwd = expandHome(fromWire(p.Cwd))
	dir := p.Cwd
	if info, err := os.Stat(dir); p.Cwd == "" || err != nil || !info.IsDir() {
		dir, _ = os.UserHomeDir()
	}
	pt, err := pty.New()
	if err != nil {
		return nil, err
	}
	if err := pt.Resize(int(max(p.Cols, 20)), int(max(p.Rows, 5))); err != nil {
		pt.Close()
		return nil, err
	}
	cmd := pt.Command(shell, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor", "SHELL="+shell, "TERM_PROGRAM=editor")
	if err := cmd.Start(); err != nil {
		pt.Close()
		return nil, err
	}

	t.mu.Lock()
	t.next++
	id := strconv.Itoa(t.next)
	t.all[id] = &terminal{cmd: cmd, pty: pt}
	t.mu.Unlock()

	read := make(chan struct{})
	go func() {
		defer close(read)
		buf := make([]byte, 32*1024)
		for {
			n, err := pt.Read(buf)
			if n > 0 {
				t.a.emit("term.data", map[string]string{"id": id, "data": base64.StdEncoding.EncodeToString(buf[:n])})
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		cmd.Wait()
		code := 0
		if cmd.ProcessState != nil {
			code = cmd.ProcessState.ExitCode()
		}
		// The pty stays open after the shell exits (on Windows, and wherever something else
		// still holds it): let the last output through, then close it to end the reader.
		select {
		case <-read:
		case <-time.After(300 * time.Millisecond):
		}
		pt.Close()
		<-read
		t.mu.Lock()
		delete(t.all, id)
		t.mu.Unlock()
		t.a.emit("term.exit", map[string]any{"id": id, "code": code})
	}()
	return map[string]string{"id": id, "shell": filepath.ToSlash(shell)}, nil
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
	return struct{}{}, term.pty.Resize(int(max(p.Cols, 2)), int(max(p.Rows, 1)))
}

// Hang up on the shell, as closing a terminal window does.
func (t *terminals) close(p struct {
	ID string `json:"id"`
}) (struct{}, error) {
	term, err := t.get(p.ID)
	if err != nil {
		return struct{}{}, nil
	}
	hangUp(term.cmd)
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
