// memory-maintenance-job-service.ts — unified memory maintenance job queue
// Manages deduplicate_memories, cleanup_memories, and tag_untagged_memories
// as queued background jobs with states: queued → running → completed/failed.
// Exposes progress via getJobStatus() for the WebUI status bar and drawer.

import { log, logError } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────

export type JobType =
  | "tag_untagged_memories"
  | "deduplicate_memories"
  | "cleanup_memories";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type JobScope =
  | "all_profiles"
  | "current_profile";

export interface MemoryMaintenanceJob {
  id: string;
  type: JobType;
  status: JobStatus;
  scope: JobScope;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  totalItems?: number;
  processedItems?: number;
  summary?: string;
  error?: string;
}

export interface JobStatusResponse {
  activity: {
    active: boolean;
    text: string;
    queuedCount: number;
  };
  current: MemoryMaintenanceJob | null;
  queued: MemoryMaintenanceJob[];
  history: MemoryMaintenanceJob[];
}

// ── Internal state ─────────────────────────────────────────────────────

const MAX_HISTORY = 50;

let queue: MemoryMaintenanceJob[] = [];
let currentJob: MemoryMaintenanceJob | null = null;
let history: MemoryMaintenanceJob[] = [];
let _running = false;

// ── Helpers ────────────────────────────────────────────────────────────

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function jobTypeLabel(type: JobType): string {
  switch (type) {
    case "cleanup_memories":
      return "Cleanup";
    case "deduplicate_memories":
      return "Deduplicate";
    case "tag_untagged_memories":
      return "Tag Untagged";
  }
}

function isConflict(existing: MemoryMaintenanceJob, type: JobType, scope: JobScope): boolean {
  // Same type and scope is always a conflict if queued or running
  return existing.type === type && existing.scope === scope;
}

// ── Public API ─────────────────────────────────────────────────────────

export function enqueueJob(type: JobType, scope: JobScope): {
  success: boolean;
  data?: MemoryMaintenanceJob;
  error?: string;
  code?: string;
} {
  // Check for conflicting queued/running jobs
  if (currentJob && isConflict(currentJob, type, scope)) {
    return {
      success: false,
      error: `A ${jobTypeLabel(type).toLowerCase()} job is already queued or running for this scope.`,
      code: "JOB_ALREADY_QUEUED_OR_RUNNING",
    };
  }

  for (const qj of queue) {
    if (isConflict(qj, type, scope)) {
      return {
        success: false,
        error: `A ${jobTypeLabel(type).toLowerCase()} job is already queued or running for this scope.`,
        code: "JOB_ALREADY_QUEUED_OR_RUNNING",
      };
    }
  }

  const job: MemoryMaintenanceJob = {
    id: generateJobId(),
    type,
    status: "queued",
    scope,
    createdAt: new Date().toISOString(),
  };

  queue.push(job);

  // Start processing if not already running
  if (!_running) {
    processQueue().catch((err) => {
      logError("job-service: queue processing error", { error: String(err) });
    });
  }

  return { success: true, data: job };
}

export function getJobStatus(): JobStatusResponse {
  // Build activity text
  let active = false;
  let text = "Idle";
  let queuedCount = queue.length;

  if (currentJob) {
    active = true;
    const label = jobTypeLabel(currentJob.type);
    if (
      currentJob.processedItems !== undefined &&
      currentJob.totalItems !== undefined &&
      currentJob.totalItems > 0
    ) {
      text = `${label} memories ${currentJob.processedItems}/${currentJob.totalItems}...`;
    } else {
      text = `${label} in progress...`;
    }
  } else if (queue.length > 0) {
    active = true;
    text = `${queue.length} job${queue.length > 1 ? "s" : ""} queued`;
  }

  // Check for recent failed jobs not yet acknowledged
  if (!active) {
    const recentFailed = history.find(
      (j) => j.status === "failed"
    );
    if (recentFailed) {
      text = `${jobTypeLabel(recentFailed.type)} failed`;
    }
  }

  return {
    activity: { active, text, queuedCount },
    current: currentJob ? { ...currentJob } : null,
    queued: queue.map((j) => ({ ...j })),
    history: history.slice(0, MAX_HISTORY),
  };
}

// ── Tag migration virtual job ──────────────────────────────────────────

// The tag migration service runs perpetually. We map its state into the
// job model for display purposes. This function returns a virtual job if
// tag migration is currently running.

export async function getTagMigrationVirtualJob(): Promise<MemoryMaintenanceJob | null> {
  try {
    const { getMigrationProgress } = await import("./tag-migration-service.js");
    const progress = getMigrationProgress();
    if (progress.status === "running") {
      return {
        id: "tag-migration-perpetual",
        type: "tag_untagged_memories",
        status: "running",
        scope: "all_profiles",
        createdAt: new Date().toISOString(),
        processedItems: progress.processed,
        totalItems: progress.total > 0 ? progress.total : undefined,
        summary: progress.errors.length > 0 ? `${progress.errors.length} errors` : undefined,
      };
    }
  } catch {
    // Tag migration service may not be available
  }
  return null;
}

// ── Queue processor ────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (_running) return;
  _running = true;

  while (queue.length > 0) {
    const job = queue.shift()!;
    currentJob = { ...job, status: "running", startedAt: new Date().toISOString() };

    try {
      await executeJob(currentJob);
      currentJob.status = "completed";
      currentJob.completedAt = new Date().toISOString();
    } catch (error) {
      currentJob.status = "failed";
      currentJob.completedAt = new Date().toISOString();
      currentJob.error = String(error);
      logError(`job-service: ${currentJob.type} failed`, { error: String(error) });
    }

    // Move to history
    history.unshift({ ...currentJob });
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    currentJob = null;
  }

  _running = false;
}

async function executeJob(job: MemoryMaintenanceJob): Promise<void> {
  switch (job.type) {
    case "cleanup_memories":
      await executeCleanupJob(job);
      break;
    case "deduplicate_memories":
      await executeDeduplicateJob(job);
      break;
    case "tag_untagged_memories":
      await executeTagMigrationJob(job);
      break;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function executeCleanupJob(job: MemoryMaintenanceJob): Promise<void> {
  const { handleCleanup } = await import("./api-handlers.js");
  const result = await handleCleanup();

  if (!result.success) {
    throw new Error(result.error || "Cleanup failed");
  }

  const data = result.data as {
    deletedMemories: number;
    deletedMemoriesUser: number;
    deletedMemoriesProject: number;
    deletedPrompts: number;
  };

  const total = data.deletedMemories + data.deletedPrompts;
  job.processedItems = total;
  job.totalItems = total;

  if (total > 0) {
    job.summary = `Processed cleanup. Removed ${data.deletedMemories} memories (${data.deletedMemoriesProject} project, ${data.deletedMemoriesUser} user) and ${data.deletedPrompts} prompts.`;
  } else {
    job.summary = "Processed cleanup. Nothing required cleanup.";
  }
}

async function executeDeduplicateJob(job: MemoryMaintenanceJob): Promise<void> {
  const { handleDeduplicate } = await import("./api-handlers.js");
  const result = await handleDeduplicate();

  if (!result.success) {
    throw new Error(result.error || "Deduplication failed");
  }

  const data = result.data as {
    totalChecked: number;
    groupsChecked: number;
    duplicatesFound: number;
    duplicatesRemoved: number;
  };

  job.processedItems = data.totalChecked;
  job.totalItems = data.totalChecked;

  if (data.duplicatesRemoved > 0) {
    job.summary = `Processed ${data.totalChecked} memories. Removed ${data.duplicatesRemoved} duplicate${data.duplicatesRemoved === 1 ? "" : "s"}.`;
  } else {
    job.summary = `Processed ${data.totalChecked} memories. No duplicates found.`;
  }
}

async function executeTagMigrationJob(job: MemoryMaintenanceJob): Promise<void> {
  const { runTagMigration } = await import("./tag-migration-service.js");
  // Fire and let the migration service handle it
  // For now, this is a one-shot trigger
  await runTagMigration();
  job.summary = "Tag migration cycle completed.";
}
