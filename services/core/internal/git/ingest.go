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
	"strconv"
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

// sourceFileLimit caps source files read for reachability. Repositories above it
// are truncated, never rejected.
const sourceFileLimit = 500

// catFileBatch reads every blob in one `git cat-file --batch` process and returns
// contents keyed by object id. Oversized or missing objects are simply absent.
func catFileBatch(ctx context.Context, repo string, ids []string) (map[string][]byte, error) {
	blobs := map[string][]byte{}
	if len(ids) == 0 {
		return blobs, nil
	}
	cmd := exec.CommandContext(ctx, "git", "cat-file", "--batch")
	cmd.Dir = repo
	cmd.Env = gitEnv(repo, "")
	cmd.Stdin = strings.NewReader(strings.Join(ids, "\n") + "\n")
	out := &limitedBuffer{limit: 24 * 1024 * 1024}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("repository fetch/read failed (unavailable, unsupported, or resource limit)")
	}
	data := out.Bytes()
	for len(data) > 0 {
		newline := bytes.IndexByte(data, '\n')
		if newline < 0 {
			break
		}
		fields := strings.Fields(string(data[:newline]))
		data = data[newline+1:]
		if len(fields) != 3 {
			continue // "<oid> missing"; the file is skipped.
		}
		size, err := strconv.Atoi(fields[2])
		if err != nil || size < 0 || size > len(data) {
			break
		}
		if fields[1] == "blob" {
			blobs[fields[0]] = data[:size:size]
		}
		data = data[size:]
		if len(data) > 0 && data[0] == '\n' {
			data = data[1:]
		}
	}
	return blobs, nil
}

func Fetch(ctx context.Context, input model.ScanInput) (model.ScanInput, error) {
	repository, err := ValidateRepository(input.Repository)
	if err != nil {
		return input, err
	}
	token := input.GitHubToken
	if token == "" {
		// Server-side default. Unauthenticated GitHub allows 60 requests an hour
		// and throttles clones; a token raises that and reaches private repos.
		token = os.Getenv("GITHUB_TOKEN")
	}
	header, err := AuthorizationHeader(token)
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
	// Large repositories are truncated rather than rejected: the manifest and
	// lockfile always win a slot, and dropped files are reported as unknown
	// reachability instead of failing the scan.
	truncated := 0
	if len(selected) > sourceFileLimit+2 {
		kept := make([]blob, 0, sourceFileLimit+2)
		for _, b := range selected {
			if b.path == "package.json" || b.path == "package-lock.json" {
				kept = append(kept, b)
			}
		}
		for _, b := range selected {
			if len(kept) >= sourceFileLimit+2 {
				break
			}
			if b.path != "package.json" && b.path != "package-lock.json" {
				kept = append(kept, b)
			}
		}
		truncated = len(selected) - len(kept)
		selected = kept
	}
	ids := make([]string, len(selected))
	for i, b := range selected {
		ids[i] = b.id
	}
	// One `cat-file --batch` instead of one process per blob: reading 500 files
	// used to fork git 500 times.
	blobs, err := catFileBatch(ctx, repo, ids)
	if err != nil {
		return input, err
	}
	input.Sources = map[string]string{}
	total := 0
	for _, b := range selected {
		content := blobs[b.id]
		switch b.path {
		case "package.json":
			if len(content) > 256*1024 {
				return input, fmt.Errorf("git output size limit exceeded")
			}
			input.Manifest = json.RawMessage(content)
		case "package-lock.json":
			if len(content) > 8*1024*1024 {
				return input, fmt.Errorf("git output size limit exceeded")
			}
			input.Lockfile = json.RawMessage(content)
		default:
			if len(content) > 256*1024 {
				truncated++
				continue
			}
			if total+len(content) > 4*1024*1024 {
				truncated++
				continue
			}
			total += len(content)
			input.Sources[b.path] = string(content)
		}
	}
	if truncated > 0 {
		input.SourceWarning = fmt.Sprintf("%d repository source files were not read (file count, file size, or the 4 MiB source budget); their imports remain unknown", truncated)
	}
	if len(input.Manifest) == 0 || len(input.Lockfile) == 0 {
		return input, fmt.Errorf("repository root requires package.json and package-lock.json")
	}
	input.Repository = repository
	return input, nil
}
