package registry

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/astra-security/astra/services/core/internal/model"
)

// packument is the subset of https://registry.npmjs.org/<name> needed for history-derived fields.
type packument struct {
	DistTags map[string]string       `json:"dist-tags"`
	Time     map[string]string       `json:"time"`
	Versions map[string]versionEntry `json:"versions"`
	raw      []byte
}

type versionEntry struct {
	Maintainers []struct {
		Name string `json:"name"`
	} `json:"maintainers"`
	NPMUser struct {
		Name string `json:"name"`
	} `json:"_npmUser"`
	// License and Scripts let enrich read the installed version straight from the
	// packument instead of a second per-package request.
	License json.RawMessage   `json:"license"`
	Scripts map[string]string `json:"scripts"`
}

// packumentVersion reports the packument entry for an exact version. A missing
// entry means the caller must fall back to the exact-version request.
func packumentVersion(pk *packument, version string) (versionEntry, bool) {
	if pk == nil {
		return versionEntry{}, false
	}
	entry, ok := pk.Versions[version]
	if !ok || len(entry.Maintainers) == 0 {
		return versionEntry{}, false
	}
	return entry, true
}

type semver struct{ major, minor, patch int }

func parseSemver(s string) (semver, bool) {
	s = strings.TrimPrefix(s, "v")
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return semver{}, false
	}
	var n [3]int
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 {
			return semver{}, false
		}
		n[i] = v
	}
	return semver{n[0], n[1], n[2]}, true
}

// gap is the hierarchical distance from installed to latest: only the most significant differing component is non-zero.
func gap(installed, latest semver) (major, minor, patch int) {
	switch {
	case latest.major > installed.major:
		return latest.major - installed.major, 0, 0
	case latest.major < installed.major:
		return 0, 0, 0
	case latest.minor > installed.minor:
		return 0, latest.minor - installed.minor, 0
	case latest.minor < installed.minor:
		return 0, 0, 0
	case latest.patch > installed.patch:
		return 0, 0, latest.patch - installed.patch
	}
	return 0, 0, 0
}

func (pk *packument) maintainersOf(version string) []string {
	v, ok := pk.Versions[version]
	if !ok {
		return nil
	}
	out := []string{}
	for _, m := range v.Maintainers {
		if m.Name != "" {
			out = append(out, m.Name)
		}
	}
	if len(out) == 0 && v.NPMUser.Name != "" {
		out = append(out, v.NPMUser.Name)
	}
	sort.Strings(out)
	return out
}

// applyHistory fills the history-derived metadata from a packument. Missing data stays zero-valued; warnings say why.
func applyHistory(p *model.Package, pk *packument, now time.Time) []string {
	warnings := []string{}
	if pk == nil {
		return append(warnings, "Registry version history unavailable for "+p.PURL)
	}
	installed, ok := parseSemver(p.Version)
	if !ok {
		warnings = append(warnings, "Installed version is not semver for "+p.PURL+"; upgrade distance unknown")
	}
	if latest := pk.DistTags["latest"]; latest != "" {
		p.Metadata.LatestVersion = latest
		p.Metadata.LatestPublishedAt = pk.Time[latest]
		if t, err := time.Parse(time.RFC3339, p.Metadata.LatestPublishedAt); err == nil {
			p.Metadata.DaysSinceLatestPublish = int(now.Sub(t).Hours() / 24)
		} else {
			warnings = append(warnings, "Latest publish date unavailable for "+p.PURL)
		}
		if lv, ok2 := parseSemver(latest); ok2 && ok {
			p.Metadata.MajorGap, p.Metadata.MinorGap, p.Metadata.PatchGap = gap(installed, lv)
		} else if ok {
			warnings = append(warnings, "Latest tag is not semver for "+p.PURL+"; upgrade distance unknown")
		}
	} else {
		warnings = append(warnings, "Registry latest tag unavailable for "+p.PURL)
	}
	if p.Metadata.PublishedAt == "" {
		p.Metadata.PublishedAt = pk.Time[p.Version]
	}
	// Time-ordered release list, semver keys only ("created"/"modified" are excluded).
	type release struct {
		version string
		at      time.Time
		sv      semver
	}
	releases := []release{}
	for v, ts := range pk.Time {
		sv, okv := parseSemver(v)
		t, err := time.Parse(time.RFC3339, ts)
		if !okv || err != nil {
			continue
		}
		releases = append(releases, release{v, t, sv})
	}
	sort.Slice(releases, func(i, j int) bool {
		if releases[i].at.Equal(releases[j].at) {
			return releases[i].version < releases[j].version
		}
		return releases[i].at.Before(releases[j].at)
	})
	idx := -1
	for i, r := range releases {
		if r.version == p.Version {
			idx = i
		}
	}
	if idx <= 0 {
		if idx < 0 {
			warnings = append(warnings, "Installed version absent from registry history for "+p.PURL)
		}
		return warnings
	}
	cur, prev := releases[idx], releases[idx-1]
	switch bump := cur.sv.major - prev.sv.major; {
	case bump >= 2:
		p.Metadata.VersionJump = true
		p.Metadata.VersionJumpNote = fmt.Sprintf("%s skipped %d major version(s) after predecessor %s", cur.version, bump-1, prev.version)
	case bump == 1 && cur.at.Sub(prev.at) < 7*24*time.Hour:
		p.Metadata.VersionJump = true
		p.Metadata.VersionJumpNote = fmt.Sprintf("%s is a major bump published %s after predecessor %s", cur.version, cur.at.Sub(prev.at).Round(time.Hour), prev.version)
	}
	curM, prevM := pk.maintainersOf(cur.version), pk.maintainersOf(prev.version)
	if len(curM) > 0 && len(prevM) > 0 && strings.Join(curM, ",") != strings.Join(prevM, ",") {
		p.Metadata.MaintainerChanged = true
		p.Metadata.PreviousMaintainers = prevM
	}
	return warnings
}
