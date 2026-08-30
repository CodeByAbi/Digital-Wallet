export const TRANSFER_QUEUE = 'transfer-queue';
export const PROCESS_TRANSFER_JOB = 'process-transfer';

export interface TransferJobData {
  transferId: string;
}

/**
 * attempts/backoff read from env so tests can override production's
 * 2s-32s exponential backoff with millisecond delays (TDD Q-03 note,
 * CLAUDE.md: "must be built in from the start, not an afterthought").
 */
export function transferJobOptions() {
  return {
    attempts: Number(process.env.TRANSFER_JOB_ATTEMPTS ?? 5),
    backoff: {
      type: 'exponential' as const,
      delay: Number(process.env.TRANSFER_JOB_BACKOFF_MS ?? 2000),
    },
    removeOnComplete: true,
    removeOnFail: false, // failed jobs stay visible in Bull Board for investigation
  };
}
