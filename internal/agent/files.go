package agent

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"sort"
	"strings"
)

const maxReadBytes = 20 * 1024 * 1024

type helloResult struct {
	Hostname string `json:"hostname"`
	User     string `json:"user"`
	Home     string `json:"home"`
	Root     string `json:"root"`
	Shell    string `json:"shell"`
}

// The folder to open: the one asked for, else Dev Spaces' projects folder, else wherever the
// agent started (the container's working directory), else home.
func hello(p struct {
	Root string `json:"root"`
}) (helloResult, error) {
	host, _ := os.Hostname()
	home, _ := os.UserHomeDir()
	name := ""
	if u, err := user.Current(); err == nil {
		name = u.Username
	}
	root := fromWire(p.Root)
	if root == "" {
		root = os.Getenv("PROJECTS_ROOT")
	}
	if root == "" {
		if wd, err := os.Getwd(); err == nil && wd != "/" {
			root = wd
		}
	}
	if root == "" {
		root = home
	}
	root = expandHome(root)
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return helloResult{}, fmt.Errorf("%s is not a folder in the container", root)
	}
	return helloResult{Hostname: host, User: name, Home: toWire(home), Root: toWire(filepath.Clean(root)), Shell: toWire(loginShell())}, nil
}

// Paths from the app use forward slashes; on Windows they're converted to the OS's own.
func fromWire(p string) string { return filepath.FromSlash(p) }

func toWire(p string) string { return filepath.ToSlash(p) }

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}

type entry struct {
	Name string `json:"name"`
	Dir  bool   `json:"dir"`
	Link bool   `json:"link"`
	Size int64  `json:"size"`
}

// Folders first, then files, each sorted case-insensitively.
func fsList(p struct {
	Path string `json:"path"`
}) ([]entry, error) {
	p.Path = fromWire(p.Path)
	items, err := os.ReadDir(p.Path)
	if err != nil {
		return nil, err
	}
	out := make([]entry, 0, len(items))
	for _, item := range items {
		e := entry{Name: item.Name()}
		info, err := item.Info()
		if err == nil {
			e.Size = info.Size()
			e.Link = info.Mode()&fs.ModeSymlink != 0
		}
		e.Dir = item.IsDir()
		if e.Link {
			if target, err := os.Stat(filepath.Join(p.Path, item.Name())); err == nil {
				e.Dir = target.IsDir()
			}
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

type readResult struct {
	Content  string `json:"content"`
	Binary   bool   `json:"binary"`
	TooLarge bool   `json:"tooLarge"`
	Size     int64  `json:"size"`
}

func fsRead(p struct {
	Path  string `json:"path"`
	Limit int64  `json:"limit"`
}) (readResult, error) {
	p.Path = fromWire(p.Path)
	info, err := os.Stat(p.Path)
	if err != nil {
		return readResult{}, err
	}
	if info.IsDir() {
		return readResult{}, fmt.Errorf("%s is a folder", p.Path)
	}
	limit := int64(maxReadBytes)
	if p.Limit > 0 && p.Limit < limit {
		limit = p.Limit
	}
	if info.Size() > limit {
		return readResult{TooLarge: true, Size: info.Size()}, nil
	}
	data, err := os.ReadFile(p.Path)
	if err != nil {
		return readResult{}, err
	}
	head := data
	if len(head) > 8000 {
		head = head[:8000]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return readResult{Binary: true, Size: info.Size()}, nil
	}
	return readResult{Content: string(data), Size: info.Size()}, nil
}

// Writes go to a temporary file beside the target, renamed over it, so a dropped connection
// never leaves a half-written file. The file keeps its permissions, and a symlink keeps
// pointing where it did (the file it points to is the one replaced).
func fsWrite(p struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}) (struct{}, error) {
	target := fromWire(p.Path)
	if resolved, err := filepath.EvalSymlinks(target); err == nil {
		target = resolved
	}
	mode := fs.FileMode(0o644)
	if info, err := os.Stat(target); err == nil {
		if info.IsDir() {
			return struct{}{}, fmt.Errorf("%s is a folder", target)
		}
		mode = info.Mode().Perm()
	} else if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return struct{}{}, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".*.tmp")
	if err != nil {
		// A folder we can't create files in may still have a writable file: write in place.
		return struct{}{}, os.WriteFile(target, []byte(p.Content), mode)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(p.Content); err != nil {
		tmp.Close()
		return struct{}{}, err
	}
	if err := tmp.Close(); err != nil {
		return struct{}{}, err
	}
	if err := os.Chmod(tmp.Name(), mode); err != nil {
		return struct{}{}, err
	}
	return struct{}{}, os.Rename(tmp.Name(), target)
}

func fsCreate(p struct {
	Path string `json:"path"`
	Dir  bool   `json:"dir"`
}) (struct{}, error) {
	p.Path = fromWire(p.Path)
	if _, err := os.Lstat(p.Path); err == nil {
		return struct{}{}, fmt.Errorf("%s already exists", filepath.Base(p.Path))
	}
	if p.Dir {
		return struct{}{}, os.MkdirAll(p.Path, 0o755)
	}
	if err := os.MkdirAll(filepath.Dir(p.Path), 0o755); err != nil {
		return struct{}{}, err
	}
	f, err := os.OpenFile(p.Path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return struct{}{}, err
	}
	return struct{}{}, f.Close()
}

func fsRename(p struct {
	From string `json:"from"`
	To   string `json:"to"`
}) (struct{}, error) {
	p.From, p.To = fromWire(p.From), fromWire(p.To)
	if _, err := os.Lstat(p.To); err == nil {
		return struct{}{}, fmt.Errorf("%s already exists", filepath.Base(p.To))
	}
	if err := os.MkdirAll(filepath.Dir(p.To), 0o755); err != nil {
		return struct{}{}, err
	}
	return struct{}{}, os.Rename(p.From, p.To)
}

func fsDelete(p struct {
	Path string `json:"path"`
}) (struct{}, error) {
	clean := filepath.Clean(fromWire(p.Path))
	// Never a whole drive or the root (or a relative path, which means nothing here).
	if clean == "." || clean == "" || filepath.Dir(clean) == clean || !filepath.IsAbs(clean) {
		return struct{}{}, errors.New("refusing to delete " + clean)
	}
	return struct{}{}, os.RemoveAll(clean)
}

type statResult struct {
	Exists bool `json:"exists"`
	Dir    bool `json:"dir"`
}

func fsStat(p struct {
	Path string `json:"path"`
}) (statResult, error) {
	info, err := os.Stat(fromWire(p.Path))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return statResult{}, nil
		}
		return statResult{}, err
	}
	return statResult{Exists: true, Dir: info.IsDir()}, nil
}
