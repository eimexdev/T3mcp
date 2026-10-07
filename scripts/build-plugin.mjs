#!/usr/bin/env node
// Packages plugin/t3-code as a ChatGPT plugin archive in dist/, plus the
// skill on its own for ChatGPT's skill import.
//
// The archive carries the skill, icon, and metadata. It deliberately has no
// mcp.json: ChatGPT marks imported plugins that declare MCP servers as
// Desktop only, and a portable mcp.json cannot express a Secure MCP Tunnel
// connection anyway. The tunnel-backed connection is the custom MCP app made
// with "Add custom MCP server". Either:
//   --base <plugin.zip>  overlay onto that plugin's own package, downloaded with
//                        "Download plugin ZIP", keeping its name and .app.json
//                        binding; upload the result with "Upload new version".
//   --app-id <id>        reference the app from a new plugin's .app.json.
//
// Usage: scripts/build-plugin.mjs [--base <plugin.zip> | --app-id <app id>] [--version <semver>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "plugin", "t3-code");
const { values } = parseArgs({
  options: { "app-id": { type: "string" }, base: { type: "string" }, version: { type: "string" } },
});

const work = fs.mkdtempSync(path.join(os.tmpdir(), "t3-code-plugin-"));
const staged = path.join(work, "t3-code");
fs.cpSync(source, staged, { recursive: true });

const manifestPath = path.join(staged, "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (values.version) manifest.version = values.version;
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`Not a semantic version: ${manifest.version}`);
const shortDescription = manifest.extensions["com.openai"].interface.shortDescription;
if (shortDescription.length > 30) throw new Error(`shortDescription is ${shortDescription.length} characters; max 30.`);

if (values["app-id"]) {
  fs.writeFileSync(
    path.join(staged, ".app.json"),
    `${JSON.stringify({ apps: { "t3-code": { id: values["app-id"], required: true } } }, null, 2)}\n`,
  );
  manifest.extensions["com.openai"].apps = "./.app.json";
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const skill of fs.readdirSync(path.join(staged, "skills"))) {
  const text = fs.readFileSync(path.join(staged, "skills", skill, "SKILL.md"), "utf8");
  const name = text.match(/^---\n[\s\S]*?^name:\s*(\S+)/m)?.[1];
  if (name !== skill) throw new Error(`skills/${skill}/SKILL.md must declare name: ${skill}`);
  if (!/^description:\s*\S/m.test(text)) throw new Error(`skills/${skill}/SKILL.md needs a description`);
}

const dist = path.join(repoRoot, "dist");
fs.mkdirSync(dist, { recursive: true });

if (values.base) {
  console.log(overlayOntoBase(values.base));
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

const archive = path.join(dist, `t3-code-${manifest.version}${values["app-id"] ? "" : "-skills"}.zip`);
fs.rmSync(archive, { force: true });
execFileSync("zip", ["-qr", "-X", archive, "t3-code"], { cwd: work });

// The skill alone, for ChatGPT's skill import (a zip with one SKILL.md).
const skillArchive = path.join(dist, `t3-code-skill-${manifest.version}.zip`);
fs.rmSync(skillArchive, { force: true });
execFileSync("zip", ["-qr", "-X", skillArchive, "t3-code"], { cwd: path.join(staged, "skills") });
fs.rmSync(work, { recursive: true, force: true });
console.log(archive);
console.log(skillArchive);

/**
 * Overlays the skill, icon, and listing onto a ChatGPT-generated plugin
 * package. Its `name` and app binding identify the tunnel-backed custom MCP
 * app, so both are kept; the version is bumped for "Upload new version".
 */
function overlayOntoBase(baseZip) {
  const baseDir = path.join(work, "base");
  fs.mkdirSync(baseDir);
  execFileSync("unzip", ["-q", path.resolve(baseZip), "-d", baseDir]);
  const rootPath = path.join(baseDir, "plugin.json");
  const legacyPath = path.join(baseDir, ".codex-plugin", "plugin.json");
  const base = JSON.parse(fs.readFileSync(fs.existsSync(rootPath) ? rootPath : legacyPath, "utf8"));
  const apps = base.extensions?.["com.openai"]?.apps ?? base.apps;
  if (!base.name || !apps) throw new Error(`${baseZip} has no plugin name or app binding to keep.`);
  if (fs.existsSync(path.join(baseDir, "mcp.json")) || fs.existsSync(path.join(baseDir, ".mcp.json"))) {
    throw new Error(`${baseZip} declares MCP servers; uploading it would make the plugin Desktop only.`);
  }

  const [major, minor] = (base.version ?? "1.0.0").split(".").map(Number);
  const version = values.version ?? `${major}.${minor + 1}.0`;
  const interfaceFields = manifest.extensions["com.openai"].interface;
  const common = {
    name: base.name,
    version,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage,
    license: manifest.license,
    keywords: manifest.keywords,
  };
  fs.cpSync(path.join(staged, "skills"), path.join(baseDir, "skills"), { recursive: true });
  fs.cpSync(path.join(staged, "assets"), path.join(baseDir, "assets"), { recursive: true });
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  write(rootPath, {
    $schema: manifest.$schema,
    ...common,
    extensions: { "com.openai": { apps, interface: interfaceFields } },
  });
  // ChatGPT generated this compatibility manifest; keep it in sync.
  write(legacyPath, { ...common, apps, skills: "./skills/", interface: interfaceFields });

  const archive = path.join(dist, `t3-code-plugin-${version}.zip`);
  fs.rmSync(archive, { force: true });
  execFileSync("zip", ["-qr", "-X", archive, "."], { cwd: baseDir });
  return archive;
}
