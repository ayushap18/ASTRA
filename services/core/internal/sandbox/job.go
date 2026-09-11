package sandbox

import (
	"context"
	"fmt"
)

type Request struct {
	Zip              []byte
	OriginalLockfile []byte
	OriginalManifest []byte
	BumpedManifest   []byte
	BumpedLockfile   []byte
}

type Outcome struct {
	Passed      bool            `json:"passed"`
	Commands    []CommandResult `json:"commands"`
	Limitations []string        `json:"limitations"`
	Scripts     []string        `json:"scripts"`
	InstallOK   bool            `json:"install_ok"`
}

func Run(ctx context.Context, runner *Runner, req Request) (Outcome, error) {
	if runner == nil || runner.Exec == nil {
		return Outcome{}, fmt.Errorf("verifier runner is not configured")
	}
	files, err := Unpack(req.Zip)
	if err != nil {
		return Outcome{}, err
	}
	if err = ProjectIdentity(files, req.OriginalManifest, req.OriginalLockfile); err != nil {
		return Outcome{}, err
	}
	if err = ValidateResolved(req.BumpedLockfile); err != nil {
		return Outcome{}, err
	}
	scripts, err := SelectedScripts(req.BumpedManifest)
	if err != nil {
		return Outcome{}, err
	}
	files["package.json"] = req.BumpedManifest
	files["package-lock.json"] = req.BumpedLockfile
	tree, err := tarFiles(files)
	if err != nil {
		return Outcome{}, err
	}
	out := Outcome{Scripts: scripts, Limitations: []string{
		"Verification means npm ci --ignore-scripts and declared test/build passed in an isolated container. It is not a safety claim.",
	}}
	volume := volumeName()
	defer runner.RemoveVolume(ctx, volume)
	extract := runner.PrepareVolume(ctx, volume, tree)
	out.Commands = append(out.Commands, extract)
	if extract.Exit != 0 {
		out.Limitations = append(out.Limitations, "Could not stage the project tree in the verify volume.")
		return out, nil
	}
	install := runner.Install(ctx, volume)
	out.Commands = append(out.Commands, install)
	if install.Exit != 0 {
		out.Limitations = append(out.Limitations, "npm ci --ignore-scripts failed.")
		return out, nil
	}
	out.InstallOK = true
	for _, script := range scripts {
		result := runner.Script(ctx, volume, script)
		out.Commands = append(out.Commands, result)
		if result.Exit != 0 {
			out.Limitations = append(out.Limitations, "Declared script "+script+" failed.")
			return out, nil
		}
	}
	out.Passed = true
	return out, nil
}
