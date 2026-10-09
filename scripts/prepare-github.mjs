import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const repo = args[0] === "--repo" && args.length === 2 ? args[1] : "";
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error("Usage: npm run prepare:github -- --repo OWNER/REPOSITORY");
  process.exitCode = 1;
} else {
  const root = new URL("../", import.meta.url);
  const configUrl = new URL("site.config.json", root);
  const config = JSON.parse(await readFile(configUrl, "utf8"));
  const url = `https://github.com/${repo}`;
  config.repositoryUrl = url;
  const readmeUrl = new URL("README.md", root);
  const readme = await readFile(readmeUrl, "utf8");
  if (!readme.includes("<!-- repository-links:start -->") || !readme.includes("<!-- repository-links:end -->")) throw new Error("README repository-link markers are missing.");
  const next = readme.replace(/<!-- repository-links:start -->[\s\S]*?<!-- repository-links:end -->/, `<!-- repository-links:start -->\n[Star on GitHub](${url}) · [Fork the starter](${url}/fork) · [Share what you built](${url}/issues/new?template=showcase.yml)\n\nIf this helps you build something, a star helps other music developers find it.\n<!-- repository-links:end -->`);
  await writeFile(configUrl, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(readmeUrl, next);
  console.log("Updated site.config.json and README links. No remote changes were made.");
}
