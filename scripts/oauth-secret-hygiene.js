"use strict";

const fs = require("fs");
const path = require("path");

const OAUTH_RESOURCE = "desktop/resources/oauth.json";
const GOOGLE_DESKTOP_SECRET = /GOCSPX-[A-Za-z0-9._~-]{20,}/;

function firstSecretLine(content) {
  const match = GOOGLE_DESKTOP_SECRET.exec(content);
  if (!match) return null;
  return content.slice(0, match.index).split("\n").length;
}

function checkFiles(root, relativePaths) {
  const files = [...new Set(relativePaths)].sort();
  const problems = [];
  if (files.includes(OAUTH_RESOURCE)) problems.push(`tracked_oauth_resource:${OAUTH_RESOURCE}`);

  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    let content;
    try {
      const value = fs.readFileSync(absolutePath);
      if (value.includes(0)) continue;
      content = value.toString("utf8");
    } catch { continue; }
    const line = firstSecretLine(content);
    if (line !== null) problems.push(`tracked_google_oauth_secret:${relativePath}:${line}`);
  }
  return problems;
}

function formatProblems(problems) {
  return ["OAuth credential hygiene check failed:", ...problems.map((problem) => `- ${problem}`)].join("\n");
}

function main() {
  const problems = checkFiles(process.cwd(), process.argv.slice(2));
  if (problems.length > 0) {
    process.stderr.write(`${formatProblems(problems)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("oauth credential hygiene check passed\n");
}

if (require.main === module) main();

module.exports = { checkFiles, formatProblems };
