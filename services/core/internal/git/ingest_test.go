package git

import (
	"os"
	"os/exec"
	"sort"
	"strings"
	"testing"
)

func TestRepositoryAllowlist(t *testing.T) {
	for _, input := range []string{"file:///etc/passwd", "https://github.com.evil.test/a/b", "https://user:pass@github.com/a/b", "http://github.com/a/b", "https://github.com/a/b?token=secret", "https://github.com/a/b/tree/main", "https://github.com/a/..", "https://127.0.0.1/a/b", "https://github.com:443/a/b"} {
		if _, err := ValidateRepository(input); err == nil {
			t.Errorf("accepted unsafe repository %q", input)
		}
	}
	for _, input := range []string{"github.com/company/project", "https://github.com/company/project.git"} {
		if _, err := ValidateRepository(input); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAuthorizationHeader(t *testing.T) {
	if _, err := AuthorizationHeader("ok"); err != nil {
		t.Fatal(err)
	}
	if _, err := AuthorizationHeader("bad token"); err == nil {
		t.Fatal("accepted token with space")
	}
	if _, err := AuthorizationHeader("user:pass"); err == nil {
		t.Fatal("accepted header-injection token")
	}
}

// catFileBatch replaces one git process per blob; this pins its stream parsing,
// including the "missing" record that carries no payload.
func TestCatFileBatchReadsEveryBlob(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	run("init", "-q")
	contents := map[string]string{"a.js": "import x from 'x';\n", "b.js": "", "c.js": strings.Repeat("z", 5000)}
	names := make([]string, 0, len(contents))
	for name, body := range contents {
		if err := os.WriteFile(dir+"/"+name, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	sort.Strings(names)
	run("add", ".")
	run("commit", "-q", "-m", "t")

	listing, err := command(t.Context(), dir, 1<<20, "", "ls-tree", "-r", "-z", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	ids, want := []string{}, []string{}
	for _, record := range strings.Split(string(listing), "\x00") {
		meta, file, ok := strings.Cut(record, "\t")
		if !ok {
			continue
		}
		ids = append(ids, strings.Fields(meta)[2])
		want = append(want, file)
	}
	// A well-formed but absent object must not desynchronise the stream.
	ids = append([]string{strings.Repeat("0", 40)}, ids...)

	blobs, err := catFileBatch(t.Context(), dir, ids)
	if err != nil {
		t.Fatal(err)
	}
	if len(blobs) != len(want) {
		t.Fatalf("read %d blobs, want %d", len(blobs), len(want))
	}
	for i, file := range want {
		if got := string(blobs[ids[i+1]]); got != contents[file] {
			t.Fatalf("%s: read %d bytes, want %d", file, len(got), len(contents[file]))
		}
	}
}
