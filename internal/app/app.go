// Package app is what the window's JavaScript calls: settings, picking a container, and a
// pipe to the agent running in it. The desktop app registers it as a Wails service;
// cmd/devserver serves it over HTTP so the UI can be worked on in a browser.
package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"editor/internal/remote"
)

type App struct {
	// Emit sends an event to the window.
	Emit func(event string, data any)
	// QuitFn closes the window for real (after the user has said to discard unsaved changes).
	QuitFn func()
	// LocalAgent, when set, is an agent binary to run on this machine instead of connecting to
	// a cluster (for development).
	LocalAgent   string
	SettingsPath string

	mu       sync.Mutex
	client   *remote.Client
	dirty    bool
	quitting bool
}

func New() *App {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return &App{SettingsPath: filepath.Join(dir, "editor", "settings.json"), Emit: func(string, any) {}, QuitFn: func() {}}
}

// Settings returns the saved settings as JSON (the window owns their shape), or "{}".
func (a *App) Settings() string {
	data, err := os.ReadFile(a.SettingsPath)
	if err != nil || !json.Valid(data) {
		return "{}"
	}
	return string(data)
}

func (a *App) SaveSettings(data string) error {
	if !json.Valid([]byte(data)) {
		return errors.New("settings aren't valid JSON")
	}
	if err := os.MkdirAll(filepath.Dir(a.SettingsPath), 0o755); err != nil {
		return err
	}
	tmp := a.SettingsPath + ".tmp"
	if err := os.WriteFile(tmp, []byte(data), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, a.SettingsPath)
}

func (a *App) oc() remote.Oc {
	var s struct {
		OcPath string `json:"ocPath"`
	}
	json.Unmarshal([]byte(a.Settings()), &s)
	return remote.Oc{Path: s.OcPath}
}

func (a *App) Platform() string { return runtime.GOOS }

func (a *App) OcProjects() (remote.Projects, error) {
	if a.LocalAgent != "" {
		return remote.Projects{Names: []string{"local"}, Current: "local"}, nil
	}
	return a.oc().Projects()
}

func (a *App) OcPods(project string) ([]remote.Pod, error) {
	if a.LocalAgent != "" {
		host, _ := os.Hostname()
		return []remote.Pod{{Name: host, Workspace: "this machine", Containers: []string{"local"}, Ready: true}}, nil
	}
	return a.oc().Pods(project)
}

// Connect starts the agent in the container, replacing any earlier connection. Progress
// comes as agent:status events, the agent's events as agent:event, and a dropped
// connection as agent:closed.
func (a *App) Connect(t remote.Target) error {
	a.Disconnect()
	var mine *remote.Client
	ready := make(chan struct{})
	onEvent := func(event string, params json.RawMessage) {
		a.Emit("agent:event", map[string]any{"event": event, "params": params})
	}
	onClose := func(err error) {
		<-ready
		a.mu.Lock()
		current := mine != nil && a.client == mine
		if current {
			a.client = nil
		}
		a.mu.Unlock()
		if current {
			a.Emit("agent:closed", err.Error())
		}
	}
	status := func(s string) { a.Emit("agent:status", s) }

	var err error
	if a.LocalAgent != "" {
		status("Starting…")
		mine, err = remote.Local(a.LocalAgent, onEvent, onClose)
	} else {
		mine, err = a.oc().Connect(t, status, onEvent, onClose)
	}
	if err != nil {
		close(ready)
		return err
	}
	a.mu.Lock()
	a.client = mine
	a.mu.Unlock()
	close(ready)
	return nil
}

func (a *App) Disconnect() {
	a.mu.Lock()
	c := a.client
	a.client = nil
	a.mu.Unlock()
	if c != nil {
		c.Close()
	}
}

// Call sends a request to the agent; params and the result are JSON.
func (a *App) Call(method string, params string) (string, error) {
	a.mu.Lock()
	c := a.client
	a.mu.Unlock()
	if c == nil {
		return "", errors.New("not connected")
	}
	if params == "" {
		params = "null"
	}
	res, err := c.Call(method, json.RawMessage(params))
	if err != nil {
		return "", err
	}
	return string(res), nil
}

// SetDirty tells the app whether any tab has unsaved changes, so closing the window can ask.
func (a *App) SetDirty(dirty bool) {
	a.mu.Lock()
	a.dirty = dirty
	a.mu.Unlock()
}

// BeforeClose decides whether the window may close: not while there are unsaved changes,
// in which case the window is asked to confirm, and calls Quit if the user agrees.
func (a *App) BeforeClose() (prevent bool) {
	a.mu.Lock()
	ask := a.dirty && !a.quitting
	a.mu.Unlock()
	if ask {
		a.Emit("app:quit-requested", nil)
		return true
	}
	return false
}

func (a *App) Quit() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	a.QuitFn()
}

// ServiceShutdown runs when the app quits (Wails calls it): it stops the agent, which hangs
// up its shells.
func (a *App) ServiceShutdown() error {
	a.Disconnect()
	return nil
}
