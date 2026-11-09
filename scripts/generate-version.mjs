/**
 * Generates public/version.json at build time.
 *
 * This script used to ALSO push a notification and an e-mail to every user, on
 * every build — including local ones, and including builds that were never
 * deployed. Announcing a release is a post-deployment concern, not a
 * compilation step, so it now lives in scripts/notify-deployment.mjs and is
 * invoked by the CI after a successful production deploy.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const version = {
  buildId: process.env.BUILD_ID || Date.now().toString(),
  timestamp: new Date().toISOString(),
  commit: gitCommit(),
  changelog: gitChangelog(),
};

const outputPath = join(process.cwd(), "public", "version.json");
writeFileSync(outputPath, `${JSON.stringify(version, null, 2)}\n`);

console.log(
  `version.json — buildId=${version.buildId} commit=${version.commit ?? "n/a"} ` +
    `changelog=${version.changelog.length} entries`,
);

function gitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // Container builds copy the source without .git — not an error.
    return null;
  }
}

function gitChangelog() {
  try {
    let command;
    try {
      const lastTag = execSync("git describe --tags --abbrev=0", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      command = `git log ${lastTag}..HEAD --pretty=format:%s --no-merges`;
    } catch {
      command = "git log -10 --pretty=format:%s --no-merges";
    }
    const log = execSync(command, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return log.split("\n").filter((line) => line.trim()).slice(0, 15);
  } catch {
    return [];
  }
}
