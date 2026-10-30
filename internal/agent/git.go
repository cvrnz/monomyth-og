package agent

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type gitResult struct {
	ok     bool
	stdout []byte
	stderr string
}

// Runs git in a repo. With quiet set, talking to remotes never prompts: a remote that needs a
// password or an unknown host key just fails, rather than waiting on input nobody can type.
func git(repo string, quiet bool, args ...string) gitResult {
	cmd := command("git", append([]string{"-C", repo}, args...)...)
	cmd.Env = os.Environ()
	if quiet {
		cmd.Env = append(cmd.Env, "GIT_TERMINAL_PROMPT=0")
		if os.Getenv("GIT_SSH_COMMAND") == "" {
			cmd.Env = append(cmd.Env, "GIT_SSH_COMMAND=ssh -o BatchMode=yes")
		}
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	return gitResult{ok: err == nil, stdout: out.Bytes(), stderr: errb.String()}
}

func rootOf(dir string) string {
	r := git(dir, false, "rev-parse", "--show-toplevel")
	if !r.ok {
		return ""
	}
	return filepath.Clean(strings.TrimSpace(string(r.stdout)))
}

// Repos at or above a folder, plus any below it (a few levels deep, skipping node_modules).
func findRepos(folder string) []string {
	var repos []string
	above := rootOf(folder)
	if above != "" {
		repos = append(repos, above)
	}
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.Name() == ".git" {
				if filepath.Clean(dir) != above {
					repos = append(repos, filepath.Clean(dir))
				}
			} else if e.IsDir() && e.Name() != "node_modules" && depth < 3 {
				walk(filepath.Join(dir, e.Name()), depth+1)
			}
		}
	}
	walk(folder, 0)
	return repos
}

type change struct {
	Status string `json:"status"`
	Path   string `json:"path"`
	Old    string `json:"old,omitempty"`
}

// Changed files from `git status`, sorted by path. Untracked files are "U".
func changes(repo string) []change {
	r := git(repo, false, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	fields := strings.Split(string(r.stdout), "\x00")
	list := []change{}
	for i := 0; i < len(fields); i++ {
		f := fields[i]
		if len(f) < 4 {
			continue
		}
		xy := f[:2]
		c := change{Path: f[3:]}
		if xy == "??" {
			c.Status = "U"
		} else {
			c.Status = strings.TrimSpace(xy)[:1]
		}
		if strings.ContainsAny(xy, "RC") && i+1 < len(fields) {
			i++
			c.Old = fields[i]
		}
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Path < list[j].Path })
	return list
}

func branch(repo string) string {
	if name := strings.TrimSpace(string(git(repo, false, "branch", "--show-current").stdout)); name != "" {
		return name
	}
	if sha := strings.TrimSpace(string(git(repo, false, "rev-parse", "--short", "HEAD").stdout)); sha != "" {
		return "detached at " + sha
	}
	return "no commits yet"
}

type syncCounts struct {
	Ahead  int `json:"ahead"`
	Behind int `json:"behind"`
}

var countsRe = regexp.MustCompile(`(\d+)\s+(\d+)`)

// Commits to push and to pull, as of the last fetch; nil for a branch with no upstream.
func syncOf(repo string) *syncCounts {
	r := git(repo, false, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
	m := countsRe.FindStringSubmatch(string(r.stdout))
	if !r.ok || m == nil {
		return nil
	}
	ahead, _ := strconv.Atoi(m[1])
	behind, _ := strconv.Atoi(m[2])
	return &syncCounts{Ahead: ahead, Behind: behind}
}

// The first remote, which a branch with no upstream is published to.
func remoteOf(repo string) string {
	lines := strings.SplitN(strings.TrimSpace(string(git(repo, false, "remote").stdout)), "\n", 2)
	return strings.TrimSpace(lines[0])
}

func arrows(s *syncCounts) string {
	if s == nil {
		return ""
	}
	var parts []string
	if s.Behind > 0 {
		parts = append(parts, "↓"+strconv.Itoa(s.Behind))
	}
	if s.Ahead > 0 {
		parts = append(parts, "↑"+strconv.Itoa(s.Ahead))
	}
	return strings.Join(parts, " ")
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strconv.Itoa(n) + " " + word + "s"
}

// What the sync button does, like VS Code's: pull, push, both, publish a branch with no
// upstream, or (with nothing to do) check the remote for new commits.
type action struct {
	Label string     `json:"label"`
	Verb  string     `json:"verb"`
	Done  string     `json:"done"`
	Dim   bool       `json:"dim,omitempty"`
	steps [][]string // "pull" stands for the pull command the repo is configured for
	fetch bool
}

func actionFor(s *syncCounts, remote string) *action {
	switch {
	case s == nil && remote == "":
		return nil
	case s == nil:
		return &action{Label: "↑ Publish branch", Verb: "Publishing", Done: "Published", steps: [][]string{{"push", "--set-upstream", remote, "HEAD"}}}
	case s.Behind > 0 && s.Ahead > 0:
		return &action{Label: "⇅ Sync changes  " + arrows(s), Verb: "Syncing", Done: "Synced", steps: [][]string{{"pull"}, {"push"}}}
	case s.Behind > 0:
		return &action{Label: "↓ Pull " + plural(s.Behind, "commit"), Verb: "Pulling", Done: "Pulled", steps: [][]string{{"pull"}}}
	case s.Ahead > 0:
		return &action{Label: "↑ Push " + plural(s.Ahead, "commit"), Verb: "Pushing", Done: "Pushed", steps: [][]string{{"push"}}}
	}
	return &action{Label: "✓ Up to date", Verb: "Checking", Done: "Up to date", Dim: true, fetch: true}
}

// Pull as the repo is configured to; with nothing configured, git refuses to pull diverged
// branches, so merge then (VS Code's default too).
func pullArgs(repo string) []string {
	if git(repo, false, "config", "pull.rebase").ok || git(repo, false, "config", "pull.ff").ok {
		return []string{"pull", "--no-edit"}
	}
	return []string{"pull", "--no-edit", "--no-rebase"}
}

type repoInfo struct {
	Path   string      `json:"path"`
	Name   string      `json:"name"`
	Branch string      `json:"branch"`
	Sync   *syncCounts `json:"sync"`
	Arrows string      `json:"arrows"`
	Remote string      `json:"remote"`
	Count  int         `json:"count"`
	Action *action     `json:"action"`
}

func infoOf(path, name string) repoInfo {
	var r repoInfo
	var wg sync.WaitGroup
	wg.Add(4)
	go func() { defer wg.Done(); r.Branch = branch(path) }()
	go func() { defer wg.Done(); r.Sync = syncOf(path) }()
	go func() { defer wg.Done(); r.Remote = remoteOf(path) }()
	go func() { defer wg.Done(); r.Count = len(changes(path)) }()
	wg.Wait()
	r.Path, r.Name = toWire(path), toWire(name)
	r.Arrows = arrows(r.Sync)
	r.Action = actionFor(r.Sync, r.Remote)
	return r
}

// Every repo in the given folders, named by their path relative to the folder.
func scmRepos(p struct {
	Roots []string `json:"roots"`
}) ([]repoInfo, error) {
	type found struct{ path, name string }
	var all []found
	seen := map[string]bool{}
	for _, root := range p.Roots {
		root = fromWire(root)
		for _, repo := range findRepos(root) {
			if seen[repo] {
				continue
			}
			seen[repo] = true
			name, err := filepath.Rel(root, repo)
			if err != nil || name == "." || strings.HasPrefix(name, "..") {
				name = filepath.Base(repo)
			}
			all = append(all, found{repo, name})
		}
	}
	out := make([]repoInfo, len(all))
	var wg sync.WaitGroup
	for i, f := range all {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out[i] = infoOf(f.path, f.name)
		}()
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func scmChanges(p struct {
	Repo string `json:"repo"`
}) ([]change, error) {
	return changes(fromWire(p.Repo)), nil
}

type version struct {
	Content string `json:"content"`
	Binary  bool   `json:"binary"`
}

// The file at the last commit and in the working tree, for a side-by-side diff.
func scmVersions(p struct {
	Repo   string `json:"repo"`
	Change change `json:"change"`
}) (map[string]version, error) {
	p.Repo = fromWire(p.Repo)
	toVersion := func(data []byte) version {
		head := data
		if len(head) > 8000 {
			head = head[:8000]
		}
		if bytes.IndexByte(head, 0) >= 0 {
			return version{Content: "(binary file)", Binary: true}
		}
		return version{Content: string(data)}
	}
	var old, now version
	c := p.Change
	if c.Status != "U" && c.Status != "A" && git(p.Repo, false, "rev-parse", "--verify", "--quiet", "HEAD").ok {
		name := c.Old
		if name == "" {
			name = c.Path
		}
		if r := git(p.Repo, false, "show", "HEAD:"+name); r.ok {
			old = toVersion(r.stdout)
		}
	}
	if c.Status != "D" {
		if data, err := os.ReadFile(filepath.Join(p.Repo, c.Path)); err == nil {
			now = toVersion(data)
		}
	}
	return map[string]version{"old": old, "new": now}, nil
}

// Fetch so the pull count is current. Returns the repo's fresh info.
func scmFetch(p struct {
	Repo string `json:"repo"`
	Name string `json:"name"`
}) (repoInfo, error) {
	p.Repo = fromWire(p.Repo)
	r := git(p.Repo, true, "fetch", "--quiet", "--no-tags")
	if !r.ok {
		return repoInfo{}, errors.New(strings.TrimSpace(r.stderr))
	}
	return infoOf(p.Repo, p.Name), nil
}

// Run the sync button's action: its git commands in turn.
func scmSync(p struct {
	Repo string `json:"repo"`
}) (struct{}, error) {
	p.Repo = fromWire(p.Repo)
	a := actionFor(syncOf(p.Repo), remoteOf(p.Repo))
	if a == nil {
		return struct{}{}, errors.New("this branch has no remote to sync with")
	}
	if a.fetch {
		if r := git(p.Repo, true, "fetch", "--quiet", "--no-tags"); !r.ok {
			return struct{}{}, errors.New(strings.TrimSpace(r.stderr))
		}
		return struct{}{}, nil
	}
	for _, args := range a.steps {
		if args[0] == "pull" {
			args = pullArgs(p.Repo)
		}
		if r := git(p.Repo, true, args...); !r.ok {
			return struct{}{}, errors.New("git " + strings.Join(args, " ") + ": " + strings.TrimSpace(r.stderr+string(r.stdout)))
		}
	}
	return struct{}{}, nil
}
