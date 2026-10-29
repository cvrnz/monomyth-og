package remote

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"editor/internal/proto"
)

// Client talks to a running agent over its stdin and stdout.
type Client struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	writeMu sync.Mutex

	mu      sync.Mutex
	next    int64
	pending map[int64]chan proto.Message
	closed  bool
	err     error

	stderr tail
	done   chan struct{}

	OnEvent func(event string, params json.RawMessage)
}

// The last few KB of the agent's stderr (oc's errors land there), to explain a dropped connection.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 4096 {
		t.buf = t.buf[len(t.buf)-4096:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}

// Start runs the command (which starts the agent) and connects to it. onEvent receives the
// agent's events; onClose is called once when the connection ends, with why.
func Start(cmd *exec.Cmd, onEvent func(string, json.RawMessage), onClose func(error)) (*Client, error) {
	c := &Client{cmd: cmd, pending: map[int64]chan proto.Message{}, done: make(chan struct{}), OnEvent: onEvent}
	hideWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = &c.stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	c.stdin = stdin

	go func() {
		in := bufio.NewReaderSize(stdout, 256*1024)
		for {
			line, err := in.ReadBytes('\n')
			if len(line) > 0 {
				var msg proto.Message
				if json.Unmarshal(line, &msg) == nil {
					c.dispatch(msg)
				}
			}
			if err != nil {
				break
			}
		}
		waitErr := cmd.Wait()
		reason := errors.New("disconnected")
		if msg := c.stderr.String(); msg != "" {
			reason = errors.New(lastLines(msg, 3))
		} else if waitErr != nil {
			reason = waitErr
		}
		c.mu.Lock()
		c.closed, c.err = true, reason
		for id, ch := range c.pending {
			ch <- proto.Message{ID: id, Error: reason.Error()}
			delete(c.pending, id)
		}
		c.mu.Unlock()
		close(c.done)
		if onClose != nil {
			onClose(reason)
		}
	}()
	return c, nil
}

func lastLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func (c *Client) dispatch(msg proto.Message) {
	if msg.Event != "" {
		if c.OnEvent != nil {
			c.OnEvent(msg.Event, msg.Params)
		}
		return
	}
	c.mu.Lock()
	ch := c.pending[msg.ID]
	delete(c.pending, msg.ID)
	c.mu.Unlock()
	if ch != nil {
		ch <- msg
	}
}

// Call sends a request and waits for its answer.
func (c *Client) Call(method string, params json.RawMessage) (json.RawMessage, error) {
	c.mu.Lock()
	if c.closed {
		err := c.err
		c.mu.Unlock()
		return nil, err
	}
	c.next++
	id := c.next
	ch := make(chan proto.Message, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	data, err := json.Marshal(proto.Message{ID: id, Method: method, Params: params})
	if err != nil {
		return nil, err
	}
	data = append(data, '\n')
	c.writeMu.Lock()
	_, err = c.stdin.Write(data)
	c.writeMu.Unlock()
	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, errors.New("disconnected")
	}

	msg := <-ch
	if msg.Error != "" {
		return nil, errors.New(msg.Error)
	}
	if len(msg.Result) == 0 || bytes.Equal(msg.Result, []byte("null")) {
		return json.RawMessage("null"), nil
	}
	return msg.Result, nil
}

// Close ends the agent: closing its stdin makes it exit (and hang up its shells); it's
// killed if that takes too long.
func (c *Client) Close() {
	c.stdin.Close()
	select {
	case <-c.done:
	case <-time.After(3 * time.Second):
		if c.cmd.Process != nil {
			c.cmd.Process.Kill()
		}
	}
}

// Done is closed when the connection has ended.
func (c *Client) Done() <-chan struct{} { return c.done }
