package remote

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Oc runs the OpenShift CLI. Apps started from the Finder or Start menu don't get the shell's
// PATH, so oc is also looked for where it's usually installed.
type Oc struct {
	Path string // from settings; empty to find it
}

func (o Oc) bin() (string, error) {
	if o.Path != "" {
		return o.Path, nil
	}
	if p, err := exec.LookPath("oc"); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	name := "oc"
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin", filepath.Join(home, "bin"), filepath.Join(home, ".local", "bin")}
	if runtime.GOOS == "windows" {
		name = "oc.exe"
		dirs = []string{filepath.Join(home, "bin"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "oc"), `C:\Program Files\oc`, `C:\oc`}
	}
	for _, d := range dirs {
		p := filepath.Join(d, name)
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, nil
		}
	}
	return "", errors.New("couldn't find the oc command; install it, or set its path in settings")
}

func (o Oc) Command(args ...string) (*exec.Cmd, error) {
	bin, err := o.bin()
	if err != nil {
		return nil, err
	}
	return exec.Command(bin, args...), nil
}

// run returns oc's output, or its error message.
func (o Oc) run(stdin []byte, args ...string) ([]byte, error) {
	cmd, err := o.Command(args...)
	if err != nil {
		return nil, err
	}
	hideWindow(cmd)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(msg, "Unauthorized") || strings.Contains(msg, "must be logged in") {
			msg = "oc isn't logged in. Run `oc login` in a terminal, then try again.\n" + msg
		}
		return nil, errors.New(msg)
	}
	return out.Bytes(), nil
}

type Projects struct {
	Names   []string `json:"names"`
	Current string   `json:"current"`
}

func (o Oc) Projects() (Projects, error) {
	var p Projects
	out, err := o.run(nil, "get", "projects", "-o", "jsonpath={.items[*].metadata.name}")
	if err != nil {
		// Plain Kubernetes, or not allowed to list projects: the current one still works.
		out, err = o.run(nil, "get", "namespaces", "-o", "jsonpath={.items[*].metadata.name}")
	}
	if err == nil {
		p.Names = strings.Fields(string(out))
	}
	if cur, cerr := o.run(nil, "project", "-q"); cerr == nil {
		p.Current = strings.TrimSpace(string(cur))
	}
	if len(p.Names) == 0 && p.Current == "" {
		if err == nil {
			err = errors.New("no projects found")
		}
		return p, err
	}
	sort.Strings(p.Names)
	return p, nil
}

type Pod struct {
	Name       string   `json:"name"`
	Workspace  string   `json:"workspace,omitempty"`
	Containers []string `json:"containers"`
	Ready      bool     `json:"ready"`
}

// Running pods in a project. Dev Spaces workspaces are labelled with their workspace name.
func (o Oc) Pods(project string) ([]Pod, error) {
	out, err := o.run(nil, "get", "pods", "-n", project, "-o", "json")
	if err != nil {
		return nil, err
	}
	var list struct {
		Items []struct {
			Metadata struct {
				Name   string            `json:"name"`
				Labels map[string]string `json:"labels"`
			} `json:"metadata"`
			Spec struct {
				Containers []struct {
					Name string `json:"name"`
				} `json:"containers"`
			} `json:"spec"`
			Status struct {
				Phase      string `json:"phase"`
				Conditions []struct {
					Type   string `json:"type"`
					Status string `json:"status"`
				} `json:"conditions"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, err
	}
	pods := []Pod{}
	for _, item := range list.Items {
		if item.Status.Phase != "Running" {
			continue
		}
		p := Pod{Name: item.Metadata.Name, Workspace: item.Metadata.Labels["controller.devfile.io/devworkspace_name"]}
		for _, c := range item.Spec.Containers {
			p.Containers = append(p.Containers, c.Name)
		}
		for _, c := range item.Status.Conditions {
			if c.Type == "Ready" {
				p.Ready = c.Status == "True"
			}
		}
		pods = append(pods, p)
	}
	sort.Slice(pods, func(i, j int) bool {
		if (pods[i].Workspace != "") != (pods[j].Workspace != "") {
			return pods[i].Workspace != ""
		}
		return pods[i].Name < pods[j].Name
	})
	return pods, nil
}

// Where to connect: a container (project, pod, container), or this computer (Local). Folder
// is the folder to open, or empty for the default.
type Target struct {
	Local     bool   `json:"local,omitempty"`
	Project   string `json:"project"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Folder    string `json:"folder"`
}

func (t Target) execArgs(cmd ...string) []string {
	args := []string{"exec", "-i", "-n", t.Project, t.Pod}
	if t.Container != "" {
		args = append(args, "-c", t.Container)
	}
	return append(append(args, "--"), cmd...)
}

// Picks a folder the agent can live in: the user's cache folder, else one in /tmp. Prints the
// architecture, the folder, and which of the given agent hashes are already there.
const probeScript = `
m=$(uname -m)
d="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/editor-agent"
if ! mkdir -p "$d" 2>/dev/null || [ ! -w "$d" ]; then d="/tmp/editor-agent-$(id -u)"; mkdir -p "$d" || exit 1; fi
echo "$m"
echo "$d"
for h in "$@"; do [ -x "$d/agent-$h" ] && echo "have $h"; done
exit 0
`

const uploadScript = `
d="$1"; f="$d/agent-$2"; t="$d/.agent-$2.$$"
cat > "$t" && chmod 755 "$t" && mv -f "$t" "$f"
`

// Connect starts the agent in the container, uploading it first if this version isn't
// there yet. status reports progress.
func (o Oc) Connect(t Target, status func(string), onEvent func(string, json.RawMessage), onClose func(error)) (*Client, error) {
	if t.Project == "" || t.Pod == "" {
		return nil, errors.New("pick a project and a pod")
	}
	var hashes []string
	for _, m := range []string{"x86_64", "aarch64"} {
		if _, h, err := agentFor(m); err == nil {
			hashes = append(hashes, h)
		}
	}
	status("Checking the container…")
	out, err := o.run(nil, t.execArgs(append([]string{"sh", "-c", probeScript, "sh"}, hashes...)...)...)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 2 {
		return nil, fmt.Errorf("unexpected reply from the container: %q", string(out))
	}
	machine, dir := strings.TrimSpace(lines[0]), strings.TrimSpace(lines[1])
	have := map[string]bool{}
	for _, l := range lines[2:] {
		have[strings.TrimPrefix(strings.TrimSpace(l), "have ")] = true
	}
	bin, hash, err := agentFor(machine)
	if err != nil {
		return nil, err
	}
	if !have[hash] {
		status(fmt.Sprintf("Uploading the agent (%d KB)…", len(bin)/1024))
		if _, err := o.run(bin, t.execArgs("sh", "-c", uploadScript, "sh", dir, hash)...); err != nil {
			return nil, fmt.Errorf("uploading the agent: %w", err)
		}
	}
	status("Starting…")
	cmd, err := o.Command(t.execArgs(dir + "/agent-" + hash)...)
	if err != nil {
		return nil, err
	}
	return Start(cmd, onEvent, onClose)
}

// Local starts an agent binary on this machine, for developing the app without a cluster.
func Local(agentPath string, onEvent func(string, json.RawMessage), onClose func(error)) (*Client, error) {
	return Start(exec.Command(agentPath), onEvent, onClose)
}
