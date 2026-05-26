// plugin/src/lib/tags.ts — Self-contained copy from shared/
import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { normalize, resolve, isAbsolute, basename, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";

const execAsync = promisify(exec);

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export interface TagInfo {
  tag: string;
  displayName: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

export interface TagsConfig {
  containerTagPrefix: string;
  userEmailOverride?: string;
  userNameOverride?: string;
}

export async function getGitEmail(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git config user.email", {
      encoding: "utf-8",
    });
    const email = stdout.trim();
    return email || null;
  } catch {
    return null;
  }
}

export async function getGitName(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git config user.name", {
      encoding: "utf-8",
    });
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function getGitRepoUrl(directory: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git config --get remote.origin.url", {
      encoding: "utf-8",
      cwd: directory,
    });
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

export async function getGitCommonDir(directory: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git rev-parse --git-common-dir", {
      encoding: "utf-8",
      cwd: directory,
    });
    const commonDir = stdout.trim();

    if (!commonDir) {
      return null;
    }

    const resolved = isAbsolute(commonDir)
      ? normalize(commonDir)
      : normalize(resolve(directory, commonDir));

    if (existsSync(resolved)) {
      return realpathSync(resolved);
    }

    return resolved;
  } catch {
    return null;
  }
}

export async function getGitTopLevel(directory: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd: directory,
    });
    const topLevel = stdout.trim();
    return topLevel || null;
  } catch {
    return null;
  }
}

export async function getProjectRoot(directory: string): Promise<string> {
  const commonDir = await getGitCommonDir(directory);
  if (commonDir && basename(commonDir) === ".git") {
    return dirname(commonDir);
  }

  const topLevel = await getGitTopLevel(directory);
  if (topLevel) {
    return topLevel;
  }

  return directory;
}

export async function getProjectIdentity(directory: string): Promise<string> {
  const commonDir = await getGitCommonDir(directory);
  if (commonDir) {
    return `git-common:${commonDir}`;
  }

  const gitRepoUrl = await getGitRepoUrl(directory);
  if (gitRepoUrl) {
    return `remote:${gitRepoUrl}`;
  }

  return `path:${normalize(directory)}`;
}

export function getProjectName(directory: string): string {
  const normalized = normalize(directory).replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p && p !== ".");
  return parts[parts.length - 1] || directory;
}

export async function getUserTagInfo(config: TagsConfig): Promise<TagInfo> {
  const email = config.userEmailOverride || (await getGitEmail());
  const name = config.userNameOverride || (await getGitName());

  if (email) {
    return {
      tag: `${config.containerTagPrefix}_user_${sha256(email)}`,
      displayName: name || email,
      userName: name || undefined,
      userEmail: email,
    };
  }

  const fallback = name || process.env.USER || process.env.USERNAME || "anonymous";
  return {
    tag: `${config.containerTagPrefix}_user_${sha256(fallback)}`,
    displayName: fallback,
    userName: fallback,
    userEmail: undefined,
  };
}

export async function getProjectTagInfo(directory: string, config: TagsConfig): Promise<TagInfo> {
  const projectRoot = await getProjectRoot(directory);
  const projectName = getProjectName(projectRoot);
  const [gitRepoUrl, projectIdentity] = await Promise.all([
    getGitRepoUrl(directory),
    getProjectIdentity(projectRoot),
  ]);

  return {
    tag: `${config.containerTagPrefix}_project_${sha256(projectIdentity)}`,
    displayName: projectRoot,
    projectPath: projectRoot,
    projectName,
    gitRepoUrl: gitRepoUrl || undefined,
  };
}

// --- Cached getTags ---

export interface TagsResult {
  user: TagInfo;
  project: TagInfo;
}

// #7: Cache is keyed by directory so that server mode serving multiple projects
// does not return stale tags from a different project.
let cachedTagsByDir = new Map<string, { tags: TagsResult; timestamp: number }>();
const CACHE_TTL = 60_000; // 1 minute

export async function getTags(directory: string, config: TagsConfig): Promise<TagsResult> {
  const cached = cachedTagsByDir.get(directory);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.tags;
  }

  const [user, project] = await Promise.all([
    getUserTagInfo(config),
    getProjectTagInfo(directory, config),
  ]);

  const result = { user, project };
  cachedTagsByDir.set(directory, { tags: result, timestamp: Date.now() });
  return result;
}
