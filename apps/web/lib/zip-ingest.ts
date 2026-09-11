export type ZipScan = {
  source: "lockfile";
  manifest: unknown;
  lockfile: unknown;
  sources: Record<string, string>;
};

function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function normalize(name: string) {
  return name.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function filesFromZip(entries: Record<string, Uint8Array>): ZipScan {
  const files: Record<string, Uint8Array> = {};
  for (const [raw, bytes] of Object.entries(entries)) {
    const name = normalize(raw);
    if (!name || name.endsWith("/")) continue;
    files[name] = bytes;
  }
  const names = Object.keys(files);
  const roots = [
    ...new Set(names.map((name) => name.split("/")[0]).filter(Boolean)),
  ];
  const prefix = roots.length === 1 ? `${roots[0]}/` : "";
  const mapped: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const relative = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (!relative || relative.includes("..") || relative.startsWith("/") || relative.includes("node_modules/")) {
      continue;
    }
    mapped[relative] = bytes;
  }
  const sources: Record<string, string> = {};
  let manifest: unknown;
  let lockfile: unknown;
  let total = 0;
  for (const [file, bytes] of Object.entries(mapped)) {
    const text = decode(bytes);
    if (file === "package.json") {
      manifest = JSON.parse(text);
      continue;
    }
    if (file === "package-lock.json") {
      lockfile = JSON.parse(text);
      continue;
    }
    if ((file.startsWith("src/") || file.startsWith("app/")) && /\.(js|jsx|ts|tsx)$/.test(file)) {
      total += text.length;
      if (total > 4 * 1024 * 1024) throw new Error("Source budget exceeds 4 MiB");
      sources[file] = text;
    }
  }
  if (!manifest || !lockfile) {
    throw new Error("ZIP root requires package.json and package-lock.json");
  }
  return { source: "lockfile", manifest, lockfile, sources };
}
