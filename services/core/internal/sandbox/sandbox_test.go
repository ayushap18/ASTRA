package sandbox

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"
)

func zipBytes(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestUnpackRejectsZipSlipAndNodeModules(t *testing.T) {
	if _, err := Unpack(zipBytes(t, map[string]string{"../etc/passwd": "x"})); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if _, err := Unpack(zipBytes(t, map[string]string{"node_modules/evil/index.js": "x"})); err == nil {
		t.Fatal("expected node_modules rejection")
	}
}

func TestUnpackStripsSingleRootAndMatchesLockfile(t *testing.T) {
	manifest := `{"name":"app","scripts":{"test":"node -e process.exit(0)"}}`
	lock := `{"lockfileVersion":3,"packages":{"":{}}}`
	files, err := Unpack(zipBytes(t, map[string]string{
		"proj/package.json":      manifest,
		"proj/package-lock.json": lock,
		"proj/src/index.js":      "module.exports=1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err = ProjectIdentity(files, []byte(manifest), []byte(lock)); err != nil {
		t.Fatal(err)
	}
	if err = ProjectIdentity(files, []byte(manifest), []byte(lock+" ")); err == nil {
		t.Fatal("expected lockfile mismatch")
	}
}

func TestSelectedScriptsRequireTestOrBuild(t *testing.T) {
	if _, err := SelectedScripts([]byte(`{"name":"app"}`)); err == nil {
		t.Fatal("expected missing scripts")
	}
	got, err := SelectedScripts([]byte(`{"scripts":{"test":"true","build":"true"}}`))
	if err != nil || strings.Join(got, ",") != "test,build" {
		t.Fatalf("got %v %v", got, err)
	}
}

func TestValidateResolvedRejectsFileURLs(t *testing.T) {
	if err := ValidateResolved([]byte(`{"packages":{"node_modules/x":{"resolved":"file:../x"}}}`)); err == nil {
		t.Fatal("expected file: rejection")
	}
	if err := ValidateResolved([]byte(`{"packages":{"node_modules/x":{"resolved":"https://registry.npmjs.org/x/-/x-1.0.0.tgz"}}}`)); err != nil {
		t.Fatal(err)
	}
}

func TestRunSetsPassedOnlyWhenInstallAndScriptsSucceed(t *testing.T) {
	manifest := `{"name":"app","scripts":{"test":"true"}}`
	lock := `{"lockfileVersion":3,"packages":{"node_modules/x":{"resolved":"https://registry.npmjs.org/x/-/x-1.0.0.tgz"}}}`
	zip := zipBytes(t, map[string]string{"package.json": manifest, "package-lock.json": lock})
	req := Request{Zip: zip, OriginalLockfile: []byte(lock), OriginalManifest: []byte(manifest), BumpedManifest: []byte(manifest), BumpedLockfile: []byte(lock)}
	exits := map[string]int{"extract": 0, "npm_ci": 1, "test": 0, "volume_create": 0, "volume_chown": 0, "volume_rm": 0}
	runner := &Runner{Image: "node:22-alpine", Alpine: "alpine:3.23", Exec: func(ctx context.Context, args []string, stdin []byte) CommandResult {
		name := "unknown"
		if len(args) > 1 && args[0] == "volume" {
			name = "volume_" + args[1]
		} else if contains(args, "chown") {
			name = "volume_chown"
		} else if contains(args, "tar") {
			name = "extract"
		} else if contains(args, "ci") {
			name = "npm_ci"
		} else if contains(args, "test") {
			name = "test"
		}
		return CommandResult{Exit: exits[name]}
	}}
	out, err := Run(context.Background(), runner, req)
	if err != nil {
		t.Fatal(err)
	}
	if out.Passed || out.InstallOK {
		t.Fatalf("install failure must not verify: %+v", out)
	}
	exits["npm_ci"] = 0
	out, err = Run(context.Background(), runner, req)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Passed || !out.InstallOK {
		t.Fatalf("expected pass: %+v", out)
	}
	exits["test"] = 1
	out, err = Run(context.Background(), runner, req)
	if err != nil {
		t.Fatal(err)
	}
	if out.Passed {
		t.Fatal("failed test must not set passed")
	}
}

func contains(args []string, needle string) bool {
	for _, a := range args {
		if a == needle {
			return true
		}
	}
	return false
}
