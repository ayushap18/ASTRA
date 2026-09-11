package sandbox

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path"
	"strings"
)

const (
	maxZipFiles        = 400
	maxUncompressed    = 32 << 20
	maxSingleFile      = 8 << 20
	maxCompressedBytes = 8 << 20
)

func Unpack(archive []byte) (map[string][]byte, error) {
	if len(archive) > maxCompressedBytes {
		return nil, fmt.Errorf("project ZIP exceeds 8 MiB")
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, fmt.Errorf("project is not a ZIP archive")
	}
	if len(reader.File) > maxZipFiles {
		return nil, fmt.Errorf("project ZIP has too many entries")
	}
	files := map[string][]byte{}
	var total int64
	for _, entry := range reader.File {
		raw := strings.ReplaceAll(entry.Name, "\\", "/")
		for _, part := range strings.Split(raw, "/") {
			if part == ".." {
				return nil, fmt.Errorf("project ZIP contains a disallowed path")
			}
		}
		name := sanitizeName(entry.Name)
		if name == "" {
			continue
		}
		if !validPath(name) {
			return nil, fmt.Errorf("project ZIP contains a disallowed path")
		}
		mode := entry.Mode()
		if mode&0o120000 == 0o120000 {
			return nil, fmt.Errorf("project ZIP must not contain symlinks")
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		if !mode.IsRegular() && mode != 0 {
			return nil, fmt.Errorf("project ZIP must contain regular files only")
		}
		if entry.UncompressedSize64 > maxSingleFile {
			return nil, fmt.Errorf("project ZIP contains a file over 8 MiB")
		}
		total += int64(entry.UncompressedSize64)
		if total > maxUncompressed {
			return nil, fmt.Errorf("project ZIP exceeds the uncompressed size budget")
		}
		src, err := entry.Open()
		if err != nil {
			return nil, fmt.Errorf("project ZIP could not be read")
		}
		data, err := io.ReadAll(io.LimitReader(src, maxSingleFile+1))
		_ = src.Close()
		if err != nil {
			return nil, fmt.Errorf("project ZIP could not be read")
		}
		if len(data) > maxSingleFile {
			return nil, fmt.Errorf("project ZIP contains a file over 8 MiB")
		}
		files[name] = data
	}
	return stripSingleRoot(files), nil
}

func sanitizeName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimPrefix(name, "./")
	if name == "" {
		return ""
	}
	cleaned := path.Clean("/" + name)
	if cleaned == "/" {
		return ""
	}
	if !strings.HasPrefix(cleaned, "/") || strings.Contains(cleaned, "/../") || cleaned == "/.." {
		return ".."
	}
	return cleaned[1:]
}

func validPath(name string) bool {
	if name == "" || name == "." || name == ".." || path.IsAbs(name) || strings.HasPrefix(name, "../") || strings.Contains(name, "/../") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." || part == "node_modules" {
			return false
		}
	}
	return true
}

func stripSingleRoot(files map[string][]byte) map[string][]byte {
	prefix := ""
	for name := range files {
		root, _, ok := strings.Cut(name, "/")
		if !ok {
			return files
		}
		if prefix == "" {
			prefix = root + "/"
			continue
		}
		if !strings.HasPrefix(name, prefix) {
			return files
		}
	}
	if prefix == "" {
		return files
	}
	out := map[string][]byte{}
	for name, data := range files {
		out[strings.TrimPrefix(name, prefix)] = data
	}
	return out
}

func ProjectIdentity(files map[string][]byte, manifest, lockfile []byte) error {
	gotLock, ok := files["package-lock.json"]
	if !ok {
		return fmt.Errorf("project ZIP must include package-lock.json")
	}
	if !bytes.Equal(gotLock, lockfile) {
		return fmt.Errorf("uploaded lockfile does not match the stored scan lockfile")
	}
	gotMan, ok := files["package.json"]
	if !ok {
		return fmt.Errorf("project ZIP must include package.json")
	}
	gotName, err := packageName(gotMan)
	if err != nil {
		return err
	}
	wantName, err := packageName(manifest)
	if err != nil {
		return err
	}
	if gotName != wantName {
		return fmt.Errorf("uploaded package.json name does not match the stored scan")
	}
	return nil
}
