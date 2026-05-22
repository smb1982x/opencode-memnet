import { CONFIG } from "../config.js";
import { createUserProfileRepository } from "./storage/factory.js";
import type { UserProfileRepository, UserProfileData } from "./storage/types.js";

interface MemoryResultMinimal {
  similarity: number;
  memory?: string;
  chunk?: string;
}

interface MemoriesResponseMinimal {
  results?: MemoryResultMinimal[];
}

export async function formatContextForPrompt(
  userId: string | null,
  projectMemories: MemoriesResponseMinimal
): Promise<string> {
  const parts: string[] = ["[MEMORY]"];

  if (CONFIG.injectProfile && userId) {
    const profileContext = await getUserProfileContext(userId);
    if (profileContext) {
      parts.push("\n" + profileContext);
    }
  }

  const projectResults = projectMemories.results || [];
  if (projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    projectResults.forEach((mem) => {
      const similarity = Math.round(mem.similarity * 100);
      const content = mem.memory || mem.chunk || "";
      parts.push(`- [${similarity}%] ${content}`);
    });
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}

async function getUserProfileContext(userId: string): Promise<string | null> {
  const profileRepo: UserProfileRepository = createUserProfileRepository();

  const profile = await profileRepo.getActiveProfile(userId);

  if (!profile) {
    return null;
  }

  let profileData: UserProfileData;
  try {
    profileData = JSON.parse(profile.profileData);
  } catch {
    return null;
  }

  const preferences = profileData?.preferences ?? [];
  const patterns = profileData?.patterns ?? [];
  const workflows = profileData?.workflows ?? [];
  const parts: string[] = [];

  if (preferences.length > 0) {
    parts.push("User Preferences:");
    preferences
      .sort((a: any, b: any) => b.confidence - a.confidence)
      .slice(0, 5)
      .forEach((pref: any) => {
        parts.push(`- [${pref.category}] ${pref.description}`);
      });
  }

  if (patterns.length > 0) {
    parts.push("\nUser Patterns:");
    patterns
      .sort((a: any, b: any) => b.frequency - a.frequency)
      .slice(0, 5)
      .forEach((pattern: any) => {
        parts.push(`- [${pattern.category}] ${pattern.description}`);
      });
  }

  if (workflows.length > 0) {
    parts.push("\nUser Workflows:");
    workflows
      .sort((a: any, b: any) => b.frequency - a.frequency)
      .slice(0, 3)
      .forEach((workflow: any) => {
        parts.push(`- ${workflow.description}`);
      });
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n");
}
