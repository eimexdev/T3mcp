#!/usr/bin/env node
// Packages plugin/t3-code as a ChatGPT plugin archive in dist/, plus the
// skill on its own for ChatGPT's skill import.
//
// The archive carries the skill, icon, and metadata. It deliberately has no
// mcp.json: ChatGPT marks imported plugins that declare MCP servers as
// Desktop only, and a portable mcp.json cannot express a Secure MCP Tunnel
// connection anyway. The tunnel-backed connection is the custom MCP app made
// with "Add custom MCP server"; pass its app ID with --app-id to reference it
// from .app.json, or overlay this archive onto that app's own plugin.
//
// Usage: scripts/build-plugin.mjs [--app-id <app id>] [--version <semver>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "plugin", "t3-code");
const { values } = parseArgs({
  options: { "app-id": { type: "string" }, version: { type: "string" } },
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
