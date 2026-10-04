import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = new Set(JSON.parse(await readFile(path.join(root, "PUBLIC_FILES.json"), "utf8")));
const excluded = new Set([".git", ".demo-state", "node_modules", ".next", ".vinext", ".wrangler", ".sites-runtime", ".agents", ".codex", "dist", "output", "outputs", "backups", "coverage", "tmp"]);
const issues = [], seen = new Set();
async function walk(relative = "") {
 for (const name of await readdir(path.join(root, relative))) {
  const file = relative ? `${relative}/${name}` : name;
  if (excluded.has(name) || file === "red-koala/data" || file === "sample-provider/data" || name === ".DS_Store" || name.endsWith(".tsbuildinfo")) continue;
  if (name.startsWith(".env") && name !== ".env.example") continue;
  const full = path.join(root, file), info = await lstat(full);
  if (info.isSymbolicLink()) { issues.push(`Symlink: ${file}`); continue; }
  if (info.isDirectory()) { await walk(file); continue; }
  seen.add(file);
  if (!allowed.has(file)) issues.push(`Not allowlisted: ${file}`);
  if (info.size > 50 * 1024 * 1024) issues.push(`Oversized: ${file}`);
  const content = await readFile(full, "utf8");
  if ([/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bAKIA[A-Z0-9]{16}\b/].some(p => p.test(content))) issues.push(`Possible secret: ${file}`);
 }
}
await walk();
for (const file of allowed) {
 if (!seen.has(file)) issues.push(`Missing or forbidden allowlist entry: ${file}`);
 if (file.split("/").some(p => excluded.has(p)) || /(?:^|\/)\.env(?!\.example$)/.test(file) || /\.(?:db|sqlite|pem|key)(?:-|$)/.test(file)) issues.push(`Forbidden file: ${file}`);
}
if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
else console.log(`Release boundary passed: ${allowed.size} source/documentation/assets files. Secret scan is heuristic; runtime files are excluded.`);
