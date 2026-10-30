// Serves the app's methods over HTTP so the UI can run in a plain browser (with `pnpm dev`,
// which proxies /api here):
//
//	go run ./cmd/devserver
//
// "This computer" works as in the app. Projects and pods come from oc, or, with -agent, there's
// one pretend pod that runs that agent binary on this machine (to try the container path
// without a cluster):
//
//	go build -o /tmp/editor-agent ./agent && go run ./cmd/devserver -agent /tmp/editor-agent
//
// POST /api/<Method> with a JSON array of arguments returns the result as JSON (or an error
// with status 500); GET /api/events streams the app's events.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"editor/internal/app"
	"editor/internal/remote"
)

func main() {
	agent := flag.String("agent", "", "agent binary to run as a pretend pod (optional)")
	addr := flag.String("addr", "127.0.0.1:34115", "address to listen on")
	flag.Parse()

	a := app.New()
	a.LocalAgent = *agent
	a.SettingsPath = filepath.Join(os.TempDir(), "monomyth-devserver-settings.json")

	var mu sync.Mutex
	subscribers := map[chan []byte]bool{}
	a.Emit = func(event string, data any) {
		msg, _ := json.Marshal(map[string]any{"event": event, "data": data})
		mu.Lock()
		for ch := range subscribers {
			select {
			case ch <- msg:
			default:
			}
		}
		mu.Unlock()
	}

	http.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
		flusher, _ := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		ch := make(chan []byte, 4096)
		mu.Lock()
		subscribers[ch] = true
		mu.Unlock()
		defer func() {
			mu.Lock()
			delete(subscribers, ch)
			mu.Unlock()
		}()
		fmt.Fprint(w, ": hi\n\n")
		flusher.Flush()
		for {
			select {
			case msg := <-ch:
				fmt.Fprintf(w, "data: %s\n\n", msg)
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})

	http.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		var args []json.RawMessage
		json.NewDecoder(r.Body).Decode(&args)
		arg := func(i int, v any) {
			if i < len(args) {
				json.Unmarshal(args[i], v)
			}
		}
		var result any
		var err error
		switch strings.TrimPrefix(r.URL.Path, "/api/") {
		case "Settings":
			result = a.Settings()
		case "SaveSettings":
			var s string
			arg(0, &s)
			err = a.SaveSettings(s)
		case "Platform":
			result = a.Platform()
		case "OcProjects":
			result, err = a.OcProjects()
		case "OcPods":
			var p string
			arg(0, &p)
			result, err = a.OcPods(p)
		case "Connect":
			var t remote.Target
			arg(0, &t)
			err = a.Connect(t)
		case "PickFolder":
			result, err = a.PickFolder()
		case "Disconnect":
			a.Disconnect()
		case "Call":
			var method, params string
			arg(0, &method)
			arg(1, &params)
			result, err = a.Call(method, params)
		case "SetDirty":
			var d bool
			arg(0, &d)
			a.SetDirty(d)
		case "Quit":
			a.Quit()
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	log.Println("devserver on http://" + *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
