package registry

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/astra-security/astra/services/core/internal/model"
)

func canned(t *testing.T, doc string) *packument {
	t.Helper()
	var pk packument
	if err := json.Unmarshal([]byte(doc), &pk); err != nil {
		t.Fatal(err)
	}
	return &pk
}

const history = `{
 "dist-tags": {"latest": "4.1.0"},
 "time": {
  "created": "2020-01-01T00:00:00Z", "modified": "2024-01-15T00:00:00Z",
  "1.0.0": "2020-01-01T00:00:00Z", "1.1.0": "2020-06-01T00:00:00Z",
  "2.0.0": "2021-01-01T00:00:00Z", "2.0.1": "2021-01-03T00:00:00Z",
  "4.0.0": "2022-01-01T00:00:00Z", "4.1.0": "2024-01-15T00:00:00Z", "5.0.0-beta.1": "2024-02-01T00:00:00Z"
 },
 "versions": {
  "1.0.0": {"maintainers": [{"name": "alice"}]},
  "1.1.0": {"maintainers": [{"name": "alice"}]},
  "2.0.0": {"maintainers": [{"name": "alice"}, {"name": "bob"}]},
  "2.0.1": {"_npmUser": {"name": "mallory"}},
  "4.0.0": {"maintainers": [{"name": "mallory"}]},
  "4.1.0": {"maintainers": [{"name": "mallory"}]}
 }
}`

func TestSemverDistance(t *testing.T) {
	now := time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		installed                 string
		major, minor, patch, days int
		warn                      string
	}{
		{"2.0.0", 2, 0, 0, 366, ""},
		{"4.0.0", 0, 1, 0, 366, ""},
		{"4.1.0", 0, 0, 0, 366, ""},
		{"5.0.0-beta.1", 0, 0, 0, 366, ""},
		{"not-a-version", 0, 0, 0, 366, "not semver"},
	} {
		p := model.Package{PURL: "pkg:npm/x@" + tc.installed, Version: tc.installed}
		w := applyHistory(&p, canned(t, history), now)
		m := p.Metadata
		if m.MajorGap != tc.major || m.MinorGap != tc.minor || m.PatchGap != tc.patch || m.DaysSinceLatestPublish != tc.days || m.LatestPublishedAt != "2024-01-15T00:00:00Z" {
			t.Errorf("%s: %+v", tc.installed, m)
		}
		if (tc.warn == "") != (len(w) == 0 || !strings.Contains(strings.Join(w, ";"), tc.warn)) {
			t.Errorf("%s: warnings %v", tc.installed, w)
		}
	}
	var p model.Package
	if w := applyHistory(&p, nil, now); len(w) != 1 || p.Metadata.DaysSinceLatestPublish != 0 || p.Metadata.LatestPublishedAt != "" {
		t.Errorf("nil packument must stay zero-valued with a warning: %+v %v", p.Metadata, w)
	}
}

func TestVersionJump(t *testing.T) {
	for _, tc := range []struct {
		installed string
		jump      bool
		note      string
	}{
		{"1.1.0", false, ""},
		{"2.0.0", false, ""},               // one major, 7 months after 1.1.0
		{"2.0.1", false, ""},               // patch
		{"4.0.0", true, "skipped 1 major"}, // 2.0.1 -> 4.0.0
		{"1.0.0", false, ""},               // first release has no predecessor
		{"9.9.9", false, ""},               // absent from history
	} {
		p := model.Package{Version: tc.installed}
		applyHistory(&p, canned(t, history), time.Now())
		if p.Metadata.VersionJump != tc.jump || !strings.Contains(p.Metadata.VersionJumpNote, tc.note) {
			t.Errorf("%s: jump=%v note=%q", tc.installed, p.Metadata.VersionJump, p.Metadata.VersionJumpNote)
		}
	}
	fast := canned(t, `{"time":{"1.0.0":"2024-01-01T00:00:00Z","2.0.0":"2024-01-03T00:00:00Z"},"versions":{}}`)
	p := model.Package{Version: "2.0.0"}
	applyHistory(&p, fast, time.Now())
	if !p.Metadata.VersionJump || !strings.Contains(p.Metadata.VersionJumpNote, "48h0m0s after predecessor 1.0.0") {
		t.Errorf("fast major bump: %+v", p.Metadata)
	}
}

func TestMaintainerChanged(t *testing.T) {
	for _, tc := range []struct {
		installed string
		changed   bool
		previous  []string
	}{
		{"1.1.0", false, nil},
		{"2.0.0", true, []string{"alice"}},        // alice -> alice,bob
		{"2.0.1", true, []string{"alice", "bob"}}, // _npmUser fallback: mallory
		{"4.0.0", false, nil},                     // mallory -> mallory
		{"1.0.0", false, nil},                     // no predecessor
	} {
		p := model.Package{Version: tc.installed, Metadata: model.Metadata{PreviousMaintainers: []string{}}}
		applyHistory(&p, canned(t, history), time.Now())
		if p.Metadata.MaintainerChanged != tc.changed || strings.Join(p.Metadata.PreviousMaintainers, ",") != strings.Join(tc.previous, ",") {
			t.Errorf("%s: changed=%v previous=%v", tc.installed, p.Metadata.MaintainerChanged, p.Metadata.PreviousMaintainers)
		}
	}
}
