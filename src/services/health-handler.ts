// src/services/health-handler.ts
import { embeddingService } from "./embedding.js";

let _dbConnected = false;
const _startTime = Date.now();

export function setDbConnected(value: boolean): void {
  _dbConnected = value;
}

export function handleHealth(): {
  status: string;
  version: string;
  dbConnected: boolean;
  embeddingReady: boolean;
  uptime: number;
} {
  const embReady = embeddingService.isWarmedUp;
  return {
    status: _dbConnected && embReady ? "ok" : "degraded",
    version: "2.14.3",
    dbConnected: _dbConnected,
    embeddingReady: embReady,
    uptime: Date.now() - _startTime,
  };
}
