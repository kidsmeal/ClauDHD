// Git facts through the GitRunner port. Every read degrades to null/empty on
// failure; a repo with a broken git never crashes a scan.

import type { CommitInfo, GitFacts } from "./model.js";
import type { GitRunner } from "./ports.js";

// \x01 delimits commit headers in --name-only output so path lines can never
// be confused with header lines.
const HDR = "\u0001";

export async function readGitFacts(
  git: GitRunner,
  repoPath: string,
  windowDays: number
): Promise<GitFacts | null> {
  const branch = await git.run(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await git.run(repoPath, ["status", "--porcelain"]);
  if (branch == null && status == null) return null; // not a usable repo

  const uncommitted =
    status == null || status === "" ? 0 : status.split(/\r?\n/).filter((l) => l.trim() !== "").length;

  const unpushedRaw = await git.run(repoPath, ["rev-list", "--count", "@{u}..HEAD"]);
  const unpushed = unpushedRaw == null ? null : parseInt(unpushedRaw, 10);

  const last = await git.run(repoPath, ["log", "-1", "--format=%cI%x09%s"]);
  let lastCommitAt: string | null = null;
  let lastCommitMsg: string | null = null;
  if (last != null && last !== "") {
    const tab = last.indexOf("\t");
    if (tab > 0) {
      lastCommitAt = last.slice(0, tab);
      lastCommitMsg = last.slice(tab + 1);
    }
  }

  const windowCommits = parseNameOnlyLog(
    await git.run(repoPath, [
      "log",
      `--since=${windowDays} days ago`,
      `--format=${HDR}%H%x09%cI%x09%s`,
      "--name-only",
    ])
  );

  return {
    branch: branch === "" ? null : branch,
    uncommitted,
    unpushed: unpushed != null && Number.isFinite(unpushed) ? unpushed : null,
    lastCommitAt,
    lastCommitMsg,
    windowCommits,
  };
}

export function parseNameOnlyLog(out: string | null): CommitInfo[] {
  if (out == null || out === "") return [];
  const commits: CommitInfo[] = [];
  let current: CommitInfo | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith(HDR)) {
      const parts = line.slice(1).split("\t");
      current = {
        hash: parts[0] ?? "",
        dateIso: parts[1] ?? "",
        subject: parts[2] ?? "",
        paths: [],
      };
      commits.push(current);
    } else if (current != null && line.trim() !== "") {
      current.paths.push(line.trim());
    }
  }
  return commits;
}

export async function countCommitsSince(
  git: GitRunner,
  repoPath: string,
  sinceMs: number
): Promise<number | null> {
  const iso = new Date(sinceMs).toISOString();
  const out = await git.run(repoPath, ["rev-list", "--count", `--since=${iso}`, "HEAD"]);
  if (out == null) return null;
  const n = parseInt(out, 10);
  return Number.isFinite(n) ? n : null;
}

export interface ShelfGit {
  uncommitted: number;
  unpushed: number | null;
}

export async function readShelfGit(git: GitRunner, repoPath: string): Promise<ShelfGit> {
  const status = await git.run(repoPath, ["status", "--porcelain"]);
  const uncommitted =
    status == null || status === "" ? 0 : status.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  const unpushedRaw = await git.run(repoPath, ["rev-list", "--count", "@{u}..HEAD"]);
  const unpushed = unpushedRaw == null ? null : parseInt(unpushedRaw, 10);
  return { uncommitted, unpushed: unpushed != null && Number.isFinite(unpushed) ? unpushed : null };
}
