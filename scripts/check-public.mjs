import { readdir, readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = new Set(JSON.parse(await readFile(path.join(root, "PUBLIC_FILES.json"), "utf8")));
const seen = new Set();
const issues = [];
async function walk(relative = "") {
  for (const name of await readdir(path.join(root, relative))) {
    const file = relative ? `${relative}/${name}` : name;
    const full = path.join(root, file);
    const info = await lstat(full);
    if (info.isSymbolicLink()) { issues.push(`Symbolic link: ${file}`); continue; }
    if (file === "node_modules" || file === ".git") continue;
    if (info.isDirectory()) { await walk(file); continue; }
    seen.add(file);
    if (!allowed.has(file)) { issues.push(`Unlisted file: ${file}`); continue; }
    const content = await readFile(full, "utf8");
    const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[a-zA-Z0-9_-]{20,}/, /\bgh[pousr]_[a-zA-Z0-9]{20,}/, /\bAKIA[A-Z0-9]{16}\b/];
    if (patterns.some(pattern => pattern.test(content))) issues.push(`Possible secret: ${file}`);
  }
}
await walk();
for (const file of allowed) if (!seen.has(file)) issues.push(`Missing listed file: ${file}`);
if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
else console.log(`Public boundary check passed: ${seen.size} allowlisted files (heuristic secret scan).`);
