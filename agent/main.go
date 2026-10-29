//go:build linux

// The agent runs inside the container, started by the app over `oc exec -i`. It reads
// requests from stdin and writes responses and events to stdout (see internal/proto), and
// exits when stdin closes, which is what happens when the app disconnects.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"

	"editor/internal/proto"
)

type handler func(params json.RawMessage) (any, error)

type agent struct {
	out      *bufio.Writer
	outMu    sync.Mutex
	handlers map[string]handler
	terms    *terminals
}

func (a *agent) send(msg proto.Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	a.outMu.Lock()
	defer a.outMu.Unlock()
	a.out.Write(data)
	a.out.WriteByte('\n')
	a.out.Flush()
}

func (a *agent) emit(event string, params any) {
	data, _ := json.Marshal(params)
	a.send(proto.Message{Event: event, Params: data})
}

func (a *agent) handle(msg proto.Message) {
	h, ok := a.handlers[msg.Method]
	if !ok {
		a.send(proto.Message{ID: msg.ID, Error: "unknown method " + msg.Method})
		return
	}
	result, err := h(msg.Params)
	if err != nil {
		a.send(proto.Message{ID: msg.ID, Error: err.Error()})
		return
	}
	data, err := json.Marshal(result)
	if err != nil {
		a.send(proto.Message{ID: msg.ID, Error: err.Error()})
		return
	}
	a.send(proto.Message{ID: msg.ID, Result: data})
}

// bind adapts a typed function to a handler, decoding its params.
func bind[P any, R any](fn func(P) (R, error)) handler {
	return func(raw json.RawMessage) (any, error) {
		var p P
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &p); err != nil {
				return nil, fmt.Errorf("bad params: %w", err)
			}
		}
		return fn(p)
	}
}

func main() {
	a := &agent{out: bufio.NewWriterSize(os.Stdout, 64*1024)}
	a.terms = newTerminals(a)
	a.handlers = map[string]handler{
		"hello":        bind(hello),
		"fs.list":      bind(fsList),
		"fs.read":      bind(fsRead),
		"fs.write":     bind(fsWrite),
		"fs.create":    bind(fsCreate),
		"fs.rename":    bind(fsRename),
		"fs.delete":    bind(fsDelete),
		"fs.stat":      bind(fsStat),
		"fs.files":     bind(fsFiles),
		"fs.grep":      bind(fsGrep),
		"scm.repos":    bind(scmRepos),
		"scm.changes":  bind(scmChanges),
		"scm.versions": bind(scmVersions),
		"scm.fetch":    bind(scmFetch),
		"scm.sync":     bind(scmSync),
		"term.open":    bind(a.terms.open),
		"term.input":   bind(a.terms.input),
		"term.resize":  bind(a.terms.resize),
		"term.close":   bind(a.terms.close),
	}

	var pending sync.WaitGroup
	in := bufio.NewReaderSize(os.Stdin, 64*1024)
	for {
		line, err := in.ReadBytes('\n')
		if len(line) > 0 {
			var msg proto.Message
			if json.Unmarshal(line, &msg) == nil && msg.Method != "" {
				pending.Add(1)
				go func() {
					defer pending.Done()
					a.handle(msg)
				}()
			}
		}
		if err != nil {
			if err != io.EOF {
				fmt.Fprintln(os.Stderr, "agent:", err)
			}
			break
		}
	}
	a.terms.closeAll()
	pending.Wait()
}
