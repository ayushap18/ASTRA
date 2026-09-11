# Synthetic Astra fixture

These manifest, lockfile, and source files mirror `services/core/internal/scanner/demo.json`. Package names and `ASTRA-DEMO-*` advisories are synthetic. This fixture is for analysis, not npm installation or execution.

Use `POST /api/v1/scans` with `{"source":"demo","denied_licenses":["GPL-3.0-only"]}` to attach deterministic fixture evidence. Uploading these files as `source: "lockfile"` instead requests live intelligence and will not find the synthetic packages.

The fixture includes nested parser versions, direct/transitive advisory matches, an unobserved package import, hypothetical lifecycle capabilities, a configured license-policy violation, and maintainer concentration. It does not prove execution reachability, emulate a real maintainer takeover, or include a working malicious script.
