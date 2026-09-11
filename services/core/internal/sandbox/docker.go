package sandbox

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const captureLimit = 64 << 10

type ExecFunc func(ctx context.Context, args []string, stdin []byte) CommandResult

type CommandResult struct {
	Name         string `json:"name"`
	Exit         int    `json:"exit"`
	StdoutSHA256 string `json:"stdout_sha256"`
	StderrSHA256 string `json:"stderr_sha256"`
	Error        string `json:"error,omitempty"`
}

type Runner struct {
	Image  string
	Alpine string
	Exec   ExecFunc
}

func NewRunner() *Runner {
	image := os.Getenv("ASTRA_VERIFY_IMAGE")
	if image == "" {
		image = "node:22-alpine"
	}
	return &Runner{Image: image, Alpine: "alpine:3.23", Exec: dockerExec}
}

func dockerExec(ctx context.Context, args []string, stdin []byte) CommandResult {
	cmd := exec.CommandContext(ctx, "docker", args...)
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &limitWriter{n: captureLimit, buf: &stdout}
	cmd.Stderr = &limitWriter{n: captureLimit, buf: &stderr}
	err := cmd.Run()
	result := CommandResult{Exit: 0, StdoutSHA256: sum(stdout.Bytes()), StderrSHA256: sum(stderr.Bytes())}
	if err == nil {
		return result
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		result.Exit = exit.ExitCode()
		return result
	}
	result.Exit = -1
	result.Error = "docker command failed"
	return result
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

type limitWriter struct {
	n   int
	buf *bytes.Buffer
}

func (w *limitWriter) Write(p []byte) (int, error) {
	if w.buf.Len() >= w.n {
		return len(p), nil
	}
	remain := w.n - w.buf.Len()
	if len(p) > remain {
		w.buf.Write(p[:remain])
		return len(p), nil
	}
	return w.buf.Write(p)
}

func isolationArgs(network, image, work string, command []string) []string {
	args := []string{
		"run", "--rm",
		"--user", "1000:1000",
		"--read-only",
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges:true",
		"--memory", "512m",
		"--cpus", "1",
		"--pids-limit", "128",
		"--tmpfs", "/tmp:size=64m",
		"--network", network,
		"-v", work + ":/work",
		"-w", "/work",
		"-e", "npm_config_ignore_scripts=true",
		image,
	}
	return append(args, command...)
}

func (r *Runner) runNamed(ctx context.Context, name string, args []string, stdin []byte, timeout time.Duration) CommandResult {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	result := r.Exec(runCtx, args, stdin)
	result.Name = name
	return result
}

func (r *Runner) PrepareVolume(ctx context.Context, name string, tree []byte) CommandResult {
	create := r.runNamed(ctx, "volume_create", []string{"volume", "create", name}, nil, 30*time.Second)
	if create.Exit != 0 {
		create.Error = "could not create verify volume"
		return create
	}
	chown := r.runNamed(ctx, "volume_chown", []string{"run", "--rm", "-v", name + ":/work", r.Alpine, "chown", "1000:1000", "/work"}, nil, 30*time.Second)
	if chown.Exit != 0 {
		return chown
	}
	extract := r.runNamed(ctx, "extract", []string{"run", "--rm", "-i", "--user", "1000:1000", "-v", name + ":/work", r.Alpine, "tar", "-x", "-C", "/work"}, tree, 60*time.Second)
	return extract
}

func (r *Runner) RemoveVolume(ctx context.Context, name string) {
	_ = r.runNamed(ctx, "volume_rm", []string{"volume", "rm", "-f", name}, nil, 30*time.Second)
}

func (r *Runner) Install(ctx context.Context, volume string) CommandResult {
	return r.runNamed(ctx, "npm_ci", isolationArgs("bridge", r.Image, volume, []string{"npm", "ci", "--ignore-scripts"}), nil, 3*time.Minute)
}

func (r *Runner) Script(ctx context.Context, volume, script string) CommandResult {
	return r.runNamed(ctx, script, isolationArgs("none", r.Image, volume, ScriptCommand(script)), nil, 2*time.Minute)
}

func (r *Runner) Available(ctx context.Context) error {
	result := r.runNamed(ctx, "info", []string{"info"}, nil, 5*time.Second)
	if result.Exit != 0 {
		return fmt.Errorf("docker engine is not available")
	}
	return nil
}

func volumeName() string {
	return "astra-verify-" + strings.ReplaceAll(fmt.Sprintf("%d", time.Now().UnixNano()), " ", "")
}
