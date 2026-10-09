import { readFile, lstat } from "node:fs/promises";
import { resolve, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readShowcase } from "../server/showcase.mjs";
import { checkSdkBoundary } from "./check-sdk-boundary.mjs";
import ts from "typescript";

// One isolated, exact upstream dependency. It is never part of the five-file MWA SDK.
const optionalAbleton = JSON.parse(await readFile(new URL("../integrations/ableton/package.json", import.meta.url), "utf8"));

export function moduleSpecifiers(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const result = [];
  function literal(node) {
    // Reviewed packaging-only load: pack-sdk verifies all five extracted files
    // against source bytes before importing this exact staged SDK entry point.
    if (filename === "scripts/pack-sdk.mjs" && node?.getText(tree) === 'pathToFileURL(join(temporary, "package/index.js")).href') return;
    if (!node || !ts.isStringLiteralLike(node)) throw new Error(`Computed module loading requires review: ${filename}`);
    result.push(node.text);
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) literal(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) literal(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) literal(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(tree); return result;
}

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export async function checkRelease() {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "release-manifest.json"), "utf8"));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Release manifest is empty.");
  if (new Set(manifest.files).size !== manifest.files.length) throw new Error("Duplicate release paths.");
  const allowed = new Set(manifest.files);
  readShowcase(JSON.parse(await readFile(resolve(projectRoot, "showcase.json"), "utf8")));
  const errors = [];
  const packageInfo = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  if (packageInfo.devDependencies?.typescript !== "5.9.3") errors.push("Review the pinned development parser before release.");
  if (JSON.stringify(optionalAbleton.dependencies) !== JSON.stringify({ "ableton-js": "3.7.3" }) || optionalAbleton.private !== true || optionalAbleton.scripts || optionalAbleton.devDependencies) errors.push("Unexpected optional Ableton package configuration.");
  for (const name of manifest.files) {
    if (typeof name !== "string" || name.includes("\\") || name.startsWith("/") || name.split("/").some(part => ["..", ".", "", "node_modules", ".git"].includes(part)) || (name.split("/").at(-1).startsWith(".env") && name !== ".env.example")) {
      errors.push(`Disallowed release path: ${name}`); continue;
    }
    let current = projectRoot;
    for (const part of name.split("/")) {
      current = resolve(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) errors.push(`Symlink forbidden: ${name}`);
    }
    const info = await lstat(current);
    if (!info.isFile()) { errors.push(`Not a regular file: ${name}`); continue; }
    const text = await readFile(current, "utf8");
    const prohibited = [
      /mwa_(?:live|test)_[A-Za-z0-9_-]{20,}/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /(?:sk_live_|sk_test_)[A-Za-z0-9]{16,}/,
      /eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
      /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//,
    ];
    if (prohibited.some(pattern => pattern.test(text))) errors.push(`Sensitive-looking content: ${name}`);
    if ([".js", ".mjs"].includes(extname(name))) {
      const syntax = spawnSync(process.execPath, ["--check", current], { encoding: "utf8" });
      if (syntax.status !== 0) errors.push(`JavaScript syntax: ${name}`);
    }
    if ([".js", ".mjs", ".ts"].includes(extname(name))) {
      let imports;
      try { imports = moduleSpecifiers(text, name); } catch (failure) { errors.push(failure.message); continue; }
      for (const specifier of imports) {
        if (specifier.startsWith("node:")) continue;
        if (name === "integrations/ableton/read.mjs" && specifier === "ableton-js") continue;
        if (name === "scripts/check-release.mjs" && specifier === "typescript") continue;
        if (!specifier.startsWith(".")) { errors.push(`Unexpected external import in ${name}: ${specifier}`); continue; }
        const target = relative(projectRoot, resolve(dirname(current), specifier)).split("\\").join("/");
        if (target.startsWith("../") || !allowed.has(target)) errors.push(`Import outside release in ${name}: ${specifier}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await checkSdkBoundary(resolve(projectRoot, "packages/sdk"));
  return manifest.files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const files = await checkRelease(); console.log(`Release boundary passed: ${files.length} explicit files; no escaping imports or detected credentials.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
