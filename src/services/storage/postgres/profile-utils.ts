/**
 * Shared pure utilities for user-profile data manipulation.
 *
 * Extracted to avoid duplication between the lazy proxy in factory.ts
 * and the concrete PostgresUserProfileRepository.
 */

import type { UserProfileData } from "../types.js";

// ── Helpers ──

function ensureArray(val: unknown): any[] {
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

/** Configuration limits consumed by {@link mergeProfileData}. */
export interface MergeProfileLimits {
  maxPreferences: number;
  maxPatterns: number;
  maxWorkflows: number;
}

/**
 * Merge incoming profile data into the existing data, applying
 * confidence boosting, deduplication, and cap enforcement.
 *
 * This is a pure function — no global state or CONFIG reads.
 * Callers must supply the limits explicitly.
 */
export function mergeProfileData(
  existing: UserProfileData,
  updates: Partial<UserProfileData>,
  limits: MergeProfileLimits
): UserProfileData {
  const merged: UserProfileData = {
    preferences: ensureArray(existing?.preferences),
    patterns: ensureArray(existing?.patterns),
    workflows: ensureArray(existing?.workflows),
  };

  if (updates.preferences) {
    const incomingPrefs = ensureArray(updates.preferences);
    for (const newPref of incomingPrefs) {
      const existingIndex = merged.preferences.findIndex(
        (p) => p.category === newPref.category && p.description === newPref.description
      );
      if (existingIndex >= 0) {
        const existingItem = merged.preferences[existingIndex];
        if (existingItem) {
          merged.preferences[existingIndex] = {
            ...newPref,
            confidence: Math.min(1, (existingItem.confidence || 0) + 0.1),
            evidence: [
              ...new Set([...ensureArray(existingItem.evidence), ...ensureArray(newPref.evidence)]),
            ].slice(0, 5),
            lastUpdated: Date.now(),
          };
        }
      } else {
        merged.preferences.push({ ...newPref, lastUpdated: Date.now() });
      }
    }
    merged.preferences.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    merged.preferences = merged.preferences.slice(0, limits.maxPreferences);
  }

  if (updates.patterns) {
    const incomingPatterns = ensureArray(updates.patterns);
    for (const newPattern of incomingPatterns) {
      const existingIndex = merged.patterns.findIndex(
        (p) => p.category === newPattern.category && p.description === newPattern.description
      );
      if (existingIndex >= 0) {
        const existingItem = merged.patterns[existingIndex];
        if (existingItem) {
          merged.patterns[existingIndex] = {
            ...newPattern,
            frequency: (existingItem.frequency || 1) + 1,
            lastSeen: Date.now(),
          };
        }
      } else {
        merged.patterns.push({ ...newPattern, frequency: 1, lastSeen: Date.now() });
      }
    }
    merged.patterns.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    merged.patterns = merged.patterns.slice(0, limits.maxPatterns);
  }

  if (updates.workflows) {
    const incomingWorkflows = ensureArray(updates.workflows);
    for (const newWorkflow of incomingWorkflows) {
      const existingIndex = merged.workflows.findIndex(
        (w) => w.description === newWorkflow.description
      );
      if (existingIndex >= 0) {
        const existingItem = merged.workflows[existingIndex];
        if (existingItem) {
          merged.workflows[existingIndex] = {
            ...newWorkflow,
            frequency: (existingItem.frequency || 1) + 1,
          };
        }
      } else {
        merged.workflows.push({ ...newWorkflow, frequency: 1 });
      }
    }
    merged.workflows.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    merged.workflows = merged.workflows.slice(0, limits.maxWorkflows);
  }

  return merged;
}
