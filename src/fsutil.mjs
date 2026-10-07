import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Creates `dir` (and parents) and tightens it to owner-only access. */
export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

/**
 * Writes `content` with mode 0600 through a temporary file and rename, so a
 * reader (tunnel-client at startup) never sees a partial secret.
 */
export function writePrivateFile(file, content) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function writeJsonFile(file, value) {
  writePrivateFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Reads a secret file and fails if it is readable by group or others. */
export function readPrivateFile(file) {
  const stat = fs.statSync(file);
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${file} is readable by other users; run: chmod 600 ${file}`);
  }
  return fs.readFileSync(file, "utf8");
}
