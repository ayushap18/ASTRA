package sandbox

import (
	"encoding/json"
	"fmt"
	"strings"
)

func packageName(manifest []byte) (string, error) {
	var pkg struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(manifest, &pkg); err != nil || pkg.Name == "" {
		return "", fmt.Errorf("package.json is missing a name")
	}
	return pkg.Name, nil
}

func SelectedScripts(manifest []byte) ([]string, error) {
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(manifest, &pkg); err != nil {
		return nil, fmt.Errorf("package.json is not valid JSON")
	}
	var selected []string
	if _, ok := pkg.Scripts["test"]; ok {
		selected = append(selected, "test")
	}
	if _, ok := pkg.Scripts["build"]; ok {
		selected = append(selected, "build")
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("package.json must declare a test or build script")
	}
	return selected, nil
}

func ScriptCommand(name string) []string {
	if name == "test" {
		return []string{"npm", "test", "--ignore-scripts"}
	}
	return []string{"npm", "run", name, "--ignore-scripts"}
}

func ValidateResolved(lockfile []byte) error {
	var tree any
	if err := json.Unmarshal(lockfile, &tree); err != nil {
		return fmt.Errorf("package-lock.json is not valid JSON")
	}
	return walkResolved(tree)
}

func walkResolved(node any) error {
	switch value := node.(type) {
	case map[string]any:
		if resolved, ok := value["resolved"].(string); ok && resolved != "" {
			if !strings.HasPrefix(resolved, "https://") {
				return fmt.Errorf("lockfile resolved URL is not HTTPS")
			}
		}
		for _, child := range value {
			if err := walkResolved(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range value {
			if err := walkResolved(child); err != nil {
				return err
			}
		}
	}
	return nil
}
