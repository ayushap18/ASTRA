// Package git fetches an allowlisted public GitHub tree without checking out or executing it.
package git

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"

	"github.com/astra-security/astra/services/core/internal/model"
)

var repoPath = regexp.MustCompile(`^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func ValidateRepository(raw string) (string, error) {
	if strings.HasPrefix(raw, "github.com/") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !repoPath.MatchString(u.Path) || path.Clean(u.Path) != u.Path {
		return "", fmt.Errorf("repository must be https://github.com/owner/repository without credentials, query, or ref")
	}
	return "https://github.com" + strings.TrimSuffix(u.Path, ".git") + ".git", nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, fmt.Errorf("git output size limit exceeded")
	}
	return b.Buffer.Write(p)
}

func AuthorizationHeader(token string) (string, error) {
	if token == "" {
		return "", nil
	}
	if len(token) > 256 || strings.ContainsAny(token, " \t\r\n:@\\\"") {
		return "", fmt.Errorf("github token is invalid")
	}
	return "Authorization: Bearer " + token, nil
}

func gitEnv(dir, extraHeader string) []string {
	count := 4
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_LFS_SKIP_SMUDGE=1", "GIT_CONFIG_KEY_0=core.hooksPath", "GIT_CONFIG_VALUE_0=/dev/null", "GIT_CONFIG_KEY_1=protocol.file.allow", "GIT_CONFIG_VALUE_1=never", "GIT_CONFIG_KEY_2=http.followRedirects", "GIT_CONFIG_VALUE_2=false", "GIT_CONFIG_KEY_3=credential.helper", "GIT_CONFIG_VALUE_3="}
	if extraHeader != "" {
		count = 5
		env = append(env, "GIT_CONFIG_KEY_4=http.extraHeader", "GIT_CONFIG_VALUE_4="+extraHeader)
	}
	return append(env, "GIT_CONFIG_COUNT="+fmt.Sprint(count))
}

func command(ctx context.Context, dir string, limit int, extraHeader string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = gitEnv(dir, extraHeader)
	out := &limitedBuffer{limit: limit}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("repository fetch/read failed (unavailable, unsupported, or resource limit)")
	}
	return out.Bytes(), nil
}

func Fetch(ctx context.Context, input model.ScanInput) (model.ScanInput, error) {
	repository, err := ValidateRepository(input.Repository)
	if err != nil {
		return input, err
	}
	header, err := AuthorizationHeader(input.GitHubToken)
	if err != nil {
		return input, err
	}
	input.GitHubToken = ""
	dir, err := os.MkdirTemp("", "astra-scan-")
	if err != nil {
		return input, err
	}
	defer os.RemoveAll(dir)
	if _, err = command(ctx, dir, 1024, header, "clone", "--bare", "--depth=1", "--filter=blob:none", "--no-tags", "--", repository, "repo.git"); err != nil {
		return input, err
	}
	repo := dir + "/repo.git"
	// ls-tree yields blob IDs and modes. Symlinks and submodules are never followed.
	listing, err := command(ctx, repo, 2*1024*1024, header, "ls-tree", "-r", "-z", "HEAD")
	if err != nil {
		return input, err
	}
	type blob struct{ id, path string }
	selected := []blob{}
	for _, record := range strings.Split(string(listing), "\x00") {
		meta, file, ok := strings.Cut(record, "\t")
		if !ok {
			continue
		}
		parts := strings.Fields(meta)
		if len(parts) != 3 || (parts[0] != "100644" && parts[0] != "100755") || parts[1] != "blob" {
			continue
		}
		if file == "package.json" || file == "package-lock.json" || ((strings.HasPrefix(file, "src/") || strings.HasPrefix(file, "app/")) && (strings.HasSuffix(file, ".js") || strings.HasSuffix(file, ".ts") || strings.HasSuffix(file, ".tsx") || strings.HasSuffix(file, ".jsx"))) {
			selected = append(selected, blob{parts[2], file})
		}
	}
	if len(selected) > 502 {
		return input, fmt.Errorf("repository exceeds 500 supported source files")
	}
	input.Sources = map[string]string{}
	total := 0
	for _, b := range selected {
		limit := 256 * 1024
		if b.path == "package-lock.json" {
			limit = 8 * 1024 * 1024
		}
		content, err := command(ctx, repo, limit, "", "cat-file", "blob", b.id)
		if err != nil {
			return input, err
		}
		switch b.path {
		case "package.json":
			input.Manifest = json.RawMessage(content)
		case "package-lock.json":
			input.Lockfile = json.RawMessage(content)
		default:
			total += len(content)
			if total > 4*1024*1024 {
				return input, fmt.Errorf("source budget exceeds 4 MiB")
			}
			input.Sources[b.path] = string(content)
		}
	}
	if len(input.Manifest) == 0 || len(input.Lockfile) == 0 {
		return input, fmt.Errorf("repository root requires package.json and package-lock.json")
	}
	input.Repository = repository
	return input, nil
}
