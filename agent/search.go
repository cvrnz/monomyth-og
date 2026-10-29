//go:build linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Search for Cmd+P: file names and text inside files. Both include hidden files, skip .git
// and respect .gitignore, like the nvim config's ripgrep searches. ripgrep is used when the
// container has it; otherwise git lists the files and the agent searches them itself.

const (
	maxFiles       = 100000
	maxMatches     = 500
	maxLineColumns = 300
	maxGrepSize    = 4 * 1024 * 1024
)

var rgPath = sync.OnceValue(func() string {
	p, _ := exec.LookPath("rg")
	return p
})

type filesResult struct {
	Files     []string `json:"files"`
	Truncated bool     `json:"truncated"`
}

// Every file under the folder, relative to it.
func fsFiles(p struct {
	Root string `json:"root"`
}) (filesResult, error) {
	root := filepath.Clean(p.Root)
	if rg := rgPath(); rg != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, rg, "--files", "--hidden", "--glob", "!.git", "--no-messages")
		cmd.Dir = root
		out, _ := cmd.Output()
		files := splitLines(out)
		res := filesResult{Files: files}
		if len(files) > maxFiles {
			res.Files, res.Truncated = files[:maxFiles], true
		}
		return res, nil
	}
	l := &lister{root: root}
	l.list(root, rootOf(root) != "")
	return filesResult{Files: l.files, Truncated: l.truncated}, nil
}

func splitLines(out []byte) []string {
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return []string{}
	}
	return lines
}

type lister struct {
	root      string
	files     []string
	truncated bool
}

func (l *lister) add(abs string) bool {
	if len(l.files) >= maxFiles {
		l.truncated = true
		return false
	}
	if rel, err := filepath.Rel(l.root, abs); err == nil {
		l.files = append(l.files, rel)
	}
	return true
}

var skipNames = map[string]bool{".git": true, "node_modules": true, ".DS_Store": true}

// Lists a folder: through git when it's (inside) a repo, so ignored files are left out,
// otherwise by reading it.
func (l *lister) list(dir string, inRepo bool) {
	if l.truncated {
		return
	}
	if inRepo || isRepoTop(dir) {
		r := git(dir, false, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
		if r.ok {
			for _, name := range strings.Split(string(r.stdout), "\x00") {
				if name == "" {
					continue
				}
				abs := filepath.Join(dir, name)
				if strings.HasSuffix(name, "/") {
					// A repo inside this one, which git doesn't look into.
					l.list(abs, false)
					continue
				}
				info, err := os.Lstat(abs)
				if err != nil {
					continue // tracked but deleted
				}
				if info.IsDir() {
					l.list(abs, false) // a submodule
					continue
				}
				if !l.add(abs) {
					return
				}
			}
			return
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if skipNames[e.Name()] {
			continue
		}
		abs := filepath.Join(dir, e.Name())
		if e.IsDir() {
			l.list(abs, false)
		} else if !l.add(abs) {
			return
		}
		if l.truncated {
			return
		}
	}
}

func isRepoTop(dir string) bool {
	_, err := os.Lstat(filepath.Join(dir, ".git"))
	return err == nil
}

type match struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Col  int    `json:"col"` // 1-based, in characters
	Text string `json:"text"`
}

type grepResult struct {
	Matches   []match `json:"matches"`
	Truncated bool    `json:"truncated"`
}

// Lines containing the text (case-insensitive unless it has capitals, like ripgrep's
// --smart-case), under the folder. Paths are relative to it.
func fsGrep(p struct {
	Root  string `json:"root"`
	Query string `json:"query"`
}) (grepResult, error) {
	root := filepath.Clean(p.Root)
	res := grepResult{Matches: []match{}}
	if p.Query == "" {
		return res, nil
	}
	if rg := rgPath(); rg != "" {
		return rgGrep(rg, root, p.Query)
	}
	files, _ := fsFiles(struct {
		Root string `json:"root"`
	}{root})
	pattern := regexp.QuoteMeta(p.Query)
	if !hasUpper(p.Query) {
		pattern = "(?i)" + pattern
	}
	re := regexp.MustCompile(pattern)

	var mu sync.Mutex
	done := false
	jobs := make(chan string)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for rel := range jobs {
				found := grepFile(filepath.Join(root, rel), rel, re)
				if len(found) == 0 {
					continue
				}
				mu.Lock()
				res.Matches = append(res.Matches, found...)
				if len(res.Matches) >= maxMatches {
					res.Matches, res.Truncated, done = res.Matches[:maxMatches], true, true
				}
				mu.Unlock()
			}
		}()
	}
	deadline := time.Now().Add(15 * time.Second)
	for _, rel := range files.Files {
		mu.Lock()
		stop := done
		mu.Unlock()
		if stop || time.Now().After(deadline) {
			break
		}
		jobs <- rel
	}
	close(jobs)
	wg.Wait()
	sortMatches(res.Matches)
	return res, nil
}

func hasUpper(s string) bool {
	for _, r := range s {
		if unicode.IsUpper(r) {
			return true
		}
	}
	return false
}

func grepFile(abs, rel string, re *regexp.Regexp) []match {
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxGrepSize {
		return nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil
	}
	head := data
	if len(head) > 8000 {
		head = head[:8000]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return nil
	}
	var out []match
	scan := bufio.NewScanner(bytes.NewReader(data))
	scan.Buffer(make([]byte, 64*1024), maxGrepSize)
	for n := 1; scan.Scan(); n++ {
		line := scan.Text()
		loc := re.FindStringIndex(line)
		if loc == nil {
			continue
		}
		out = append(out, match{Path: rel, Line: n, Col: utf8.RuneCountInString(line[:loc[0]]) + 1, Text: clip(line)})
		if len(out) >= 50 {
			break
		}
	}
	return out
}

func clip(line string) string {
	line = strings.TrimRight(line, "\r")
	if utf8.RuneCountInString(line) <= maxLineColumns {
		return line
	}
	return string([]rune(line)[:maxLineColumns])
}

// By path, then line: the workers finish in any order.
func sortMatches(m []match) {
	sort.Slice(m, func(i, j int) bool {
		if m[i].Path != m[j].Path {
			return m[i].Path < m[j].Path
		}
		return m[i].Line < m[j].Line
	})
}

// ripgrep's output, one "path:line:column:text" per match.
func rgGrep(rg, root, query string) (grepResult, error) {
	res := grepResult{Matches: []match{}}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, rg, "--hidden", "--glob", "!.git", "--smart-case", "--fixed-strings",
		"--line-number", "--column", "--no-heading", "--with-filename", "--color", "never", "--no-messages",
		"--max-count", "50", "--max-filesize", "4M", "--", query, ".")
	cmd.Dir = root
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return res, err
	}
	if err := cmd.Start(); err != nil {
		return res, err
	}
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scan.Scan() {
		parts := strings.SplitN(scan.Text(), ":", 4)
		if len(parts) < 4 {
			continue
		}
		line, _ := strconv.Atoi(parts[1])
		col, _ := strconv.Atoi(parts[2]) // a byte offset; converted to characters below
		text := parts[3]
		if col > 0 && col-1 <= len(text) {
			col = utf8.RuneCountInString(text[:col-1]) + 1
		}
		res.Matches = append(res.Matches, match{Path: strings.TrimPrefix(parts[0], "./"), Line: line, Col: col, Text: clip(text)})
		if len(res.Matches) >= maxMatches {
			res.Truncated = true
			cancel()
			break
		}
	}
	cmd.Wait()
	return res, nil
}
