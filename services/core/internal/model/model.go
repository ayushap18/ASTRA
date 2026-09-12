package model

import (
	"encoding/json"
	"time"
)

type Evidence struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Source     string  `json:"source"`
	Location   string  `json:"location,omitempty"`
	SHA256     string  `json:"sha256,omitempty"`
	Summary    string  `json:"summary"`
	Confidence float64 `json:"confidence"`
}
type Vulnerability struct {
	ID            string   `json:"id"`
	Summary       string   `json:"summary"`
	Severity      string   `json:"severity"`
	FixedVersions []string `json:"fixed_versions"`
	EvidenceID    string   `json:"evidence_id"`
}
type Script struct {
	Name         string   `json:"name"`
	Capabilities []string `json:"capabilities"`
	EvidenceID   string   `json:"evidence_id"`
}
type Reachability struct {
	Level       int      `json:"level"`
	Status      string   `json:"status"`
	EvidenceIDs []string `json:"evidence_ids"`
}
type Metadata struct {
	RegistryStatus   string   `json:"registry_status"`
	OSVStatus        string   `json:"osv_status"`
	LatestVersion    string   `json:"latest_version,omitempty"`
	Maintainers      []string `json:"maintainers"`
	PublishedAt      string   `json:"published_at,omitempty"`
	HasInstallScript bool     `json:"has_install_script"`
	// Registry history fields; zero values mean unknown (see RegistryStatus).
	LatestPublishedAt string `json:"latest_published_at"`
	MajorGap          int    `json:"major_gap"`
	MinorGap          int    `json:"minor_gap"`
	PatchGap          int    `json:"patch_gap"`
	// ponytail: computed at scan time against time.Now(); a stored scan ages without this number moving.
	DaysSinceLatestPublish int      `json:"days_since_latest_publish"`
	MaintainerChanged      bool     `json:"maintainer_changed"`
	PreviousMaintainers    []string `json:"previous_maintainers"`
	VersionJump            bool     `json:"version_jump"`
	VersionJumpNote        string   `json:"version_jump_note"`
}
type Package struct {
	ID              string          `json:"id"`
	PURL            string          `json:"purl"`
	Ecosystem       string          `json:"ecosystem"`
	Name            string          `json:"name"`
	Version         string          `json:"version"`
	InstallPath     string          `json:"install_path"`
	Direct          bool            `json:"direct"`
	Depth           int             `json:"depth"`
	Dev             bool            `json:"dev"`
	License         string          `json:"license,omitempty"`
	Metadata        Metadata        `json:"metadata"`
	Vulnerabilities []Vulnerability `json:"vulnerabilities"`
	InstallScripts  []Script        `json:"install_scripts"`
	Reachability    Reachability    `json:"reachability"`
	EvidenceIDs     []string        `json:"evidence_ids"`
	Risk            json.RawMessage `json:"risk,omitempty"`
}
type Edge struct {
	Source      string `json:"source"`
	Target      string `json:"target"`
	Requirement string `json:"requirement"`
	Scope       string `json:"scope"`
	Reachable   bool   `json:"reachable"`
}
type Graph struct {
	SchemaVersion  string     `json:"schema_version"`
	RootID         string     `json:"root_id"`
	ProjectLicense string     `json:"project_license"`
	Packages       []Package  `json:"packages"`
	Edges          []Edge     `json:"edges"`
	Evidence       []Evidence `json:"evidence"`
	Warnings       []string   `json:"warnings"`
}
type ScanInput struct {
	Source         string            `json:"source"`
	Repository     string            `json:"repository,omitempty"`
	Manifest       json.RawMessage   `json:"manifest,omitempty"`
	Lockfile       json.RawMessage   `json:"lockfile,omitempty"`
	Sources        map[string]string `json:"sources,omitempty"`
	GitHubToken    string            `json:"github_token,omitempty"`
	SourceWarning  string            `json:"source_warning,omitempty"`
	DeniedLicenses []string          `json:"denied_licenses,omitempty"`
}
type Event struct {
	ID       int       `json:"id"`
	Type     string    `json:"type"`
	Stage    string    `json:"stage"`
	Progress int       `json:"progress"`
	Message  string    `json:"message"`
	Time     time.Time `json:"time"`
}
type Scan struct {
	ID             string          `json:"id"`
	Source         string          `json:"source"`
	Repository     string          `json:"repository,omitempty"`
	Status         string          `json:"status"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	Graph          *Graph          `json:"graph,omitempty"`
	Analysis       json.RawMessage `json:"analysis,omitempty"`
	Events         []Event         `json:"events"`
	Error          string          `json:"error,omitempty"`
	DeniedLicenses []string        `json:"denied_licenses"`
	Manifest       json.RawMessage `json:"manifest,omitempty"`
	Lockfile       json.RawMessage `json:"lockfile,omitempty"`
}

type ScanSummary struct {
	ID         string          `json:"id"`
	Source     string          `json:"source"`
	Repository string          `json:"repository,omitempty"`
	Status     string          `json:"status"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	Error      string          `json:"error,omitempty"`
	Summary    json.RawMessage `json:"summary,omitempty"`
	Stage      string          `json:"stage,omitempty"`
	Progress   int             `json:"progress"`
	Message    string          `json:"message,omitempty"`
}
