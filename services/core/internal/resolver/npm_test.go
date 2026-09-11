package resolver

import (
	"encoding/json"
	"strings"
	"testing"
)

func lock(packages map[string]any) []byte {
	b, _ := json.Marshal(map[string]any{"lockfileVersion": 3, "packages": packages})
	return b
}
func TestNestedScopedAndHoistedResolution(t *testing.T) {
	g, err := Parse([]byte(`{"dependencies":{"a":"1","@scope/b":"2"}}`), lock(map[string]any{
		"": map[string]any{"dependencies": map[string]string{"a": "1", "@scope/b": "2"}}, "node_modules/a": map[string]any{"version": "1.0.0", "dependencies": map[string]string{"shared": "1"}},
		"node_modules/a/node_modules/shared": map[string]any{"version": "1.0.0"},
		"node_modules/@scope/b":              map[string]any{"version": "2.0.0", "dependencies": map[string]string{"shared": "2"}},
		"node_modules/shared":                map[string]any{"version": "2.0.0"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Packages) != 4 || len(g.Edges) != 4 {
		t.Fatalf("wrong graph: %+v", g)
	}
	for _, edge := range g.Edges {
		if strings.Contains(edge.Source, "@1.0.0#node_modules/a") && !strings.Contains(edge.Target, "a/node_modules/shared") {
			t.Fatal("nested instance lost")
		}
		if strings.Contains(edge.Source, "%40scope/b") && !strings.Contains(edge.Target, "shared@2.0.0") {
			t.Fatal("hoisted scoped resolution failed")
		}
	}
	for _, p := range g.Packages {
		if p.Name == "shared" && p.Depth != 2 {
			t.Fatalf("incorrect shortest depth %d", p.Depth)
		}
	}
}
func TestRejectUnsupportedAndIncompleteLocks(t *testing.T) {
	cases := []string{`{"lockfileVersion":1}`, `{"lockfileVersion":3,"packages":{}}`, `{"lockfileVersion":3,"packages":{"":{}}}`, `{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","link":true}}}`, `{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","resolved":"file:../a"}}}`}
	for _, data := range cases {
		if _, err := Parse([]byte(`{"dependencies":{"a":"1"}}`), []byte(data)); err == nil {
			t.Errorf("accepted %s", data)
		}
	}
}
func TestOptionalMissingAndCycles(t *testing.T) {
	g, err := Parse([]byte(`{"dependencies":{"a":"1"},"optionalDependencies":{"native":"1"}}`), lock(map[string]any{"": map[string]any{"dependencies": map[string]string{"a": "1"}, "optionalDependencies": map[string]string{"native": "1"}}, "node_modules/a": map[string]any{"version": "1.0.0", "dependencies": map[string]string{"b": "1"}}, "node_modules/b": map[string]any{"version": "1.0.0", "dependencies": map[string]string{"a": "1"}}}))
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Warnings) != 1 || len(g.Edges) != 3 {
		t.Fatal("optional/cycle handling incorrect")
	}
}

func TestRejectStaleManifestAndUnsafeOrigins(t *testing.T) {
	manifest := []byte(`{"dependencies":{"a":"1"}}`)
	root := map[string]any{"dependencies": map[string]string{"a": "1"}}
	for _, entry := range []map[string]any{{"version": "1.0.0", "link": true}, {"version": "1.0.0", "resolved": "file:../a"}} {
		_, err := Parse(manifest, lock(map[string]any{"": root, "node_modules/a": entry}))
		if err == nil || strings.Contains(err.Error(), "declarations differ") {
			t.Fatalf("unsupported source was not checked: %v", err)
		}
	}
	_, err := Parse([]byte(`{"dependencies":{"a":"2"}}`), lock(map[string]any{"": root, "node_modules/a": map[string]any{"version": "1.0.0"}}))
	if err == nil || !strings.Contains(err.Error(), "declarations differ") {
		t.Fatal("stale manifest accepted")
	}
}

func TestApplyDirectUpgradesBumpsExactPinAndPreservesRanges(t *testing.T) {
	manifest := []byte(`{"dependencies":{"a":"1.0.0","b":"^2.0.0"}}`)
	data := lock(map[string]any{
		"":                    map[string]any{"dependencies": map[string]string{"a": "1.0.0", "b": "^2.0.0"}},
		"node_modules/a":      map[string]any{"version": "1.0.0", "dependencies": map[string]string{"shared": "1"}},
		"node_modules/b":      map[string]any{"version": "2.0.0"},
		"node_modules/shared": map[string]any{"version": "1.0.0"},
	})
	nextManifest, nextLock, err := ApplyDirectUpgrades(manifest, data, []DirectUpgrade{
		{Name: "a", From: "1.0.0", To: "1.0.1", InstallPath: "node_modules/a"},
		{Name: "b", From: "2.0.0", To: "2.0.1", InstallPath: "node_modules/b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	g, err := Parse(nextManifest, nextLock)
	if err != nil {
		t.Fatal(err)
	}
	versions := map[string]string{}
	for _, p := range g.Packages {
		versions[p.InstallPath] = p.Version
	}
	if versions["node_modules/a"] != "1.0.1" || versions["node_modules/b"] != "2.0.1" {
		t.Fatalf("versions %+v", versions)
	}
	var m Manifest
	_ = json.Unmarshal(nextManifest, &m)
	if m.Dependencies["a"] != "1.0.1" || m.Dependencies["b"] != "^2.0.0" {
		t.Fatalf("root pins %+v", m.Dependencies)
	}
}

func TestApplyDirectUpgradesRejectsMissingOrMismatchedInstance(t *testing.T) {
	manifest := []byte(`{"dependencies":{"a":"1.0.0"}}`)
	data := lock(map[string]any{"": map[string]any{"dependencies": map[string]string{"a": "1.0.0"}}, "node_modules/a": map[string]any{"version": "1.0.0"}})
	if _, _, err := ApplyDirectUpgrades(manifest, data, []DirectUpgrade{{Name: "a", From: "9.9.9", To: "1.0.1", InstallPath: "node_modules/a"}}); err == nil {
		t.Fatal("mismatched from-version accepted")
	}
	if _, _, err := ApplyDirectUpgrades(manifest, data, []DirectUpgrade{{Name: "a", From: "1.0.0", To: "1.0.1", InstallPath: "node_modules/missing"}}); err == nil {
		t.Fatal("missing instance accepted")
	}
}
