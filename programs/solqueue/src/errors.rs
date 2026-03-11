use anchor_lang::prelude::*;

#[error_code]
pub enum SolQueueError {
    // ── Queue errors ───────────────────────────────────────────────────────
    #[msg("Queue is currently paused. No new jobs can be enqueued.")]
    QueuePaused,

    #[msg("Queue name exceeds 32 characters.")]
    QueueNameTooLong,

    #[msg("Job type string exceeds 32 characters.")]
    JobTypeTooLong,

    #[msg("Payload exceeds the 512-byte maximum. Store large payloads off-chain and pass a content hash.")]
    PayloadTooLarge,

    // ── Job state machine errors ───────────────────────────────────────────
    #[msg("Job is not in Pending status. It may have already been claimed by another worker.")]
    JobNotPending,

    #[msg("Job is not in Processing status. Cannot complete or fail a job that is not active.")]
    JobNotProcessing,

    #[msg("Only the assigned worker may complete or fail this job.")]
    WrongWorker,

    #[msg("Job has already been completed or permanently failed.")]
    JobAlreadyFinished,

    // ── Worker errors ──────────────────────────────────────────────────────
    #[msg("Worker is not registered for this queue.")]
    WorkerNotRegistered,

    #[msg("Worker has been deactivated by the queue authority.")]
    WorkerDeactivated,

    #[msg("Worker is already registered for this queue.")]
    WorkerAlreadyRegistered,

    // ── Expiry errors ──────────────────────────────────────────────────────
    #[msg("Job has not yet exceeded the timeout window. Cannot expire it yet.")]
    JobNotExpired,

    #[msg("Job is not in Processing status. Only Processing jobs can be expired.")]
    CannotExpireNonProcessingJob,

    // ── Permission errors ──────────────────────────────────────────────────
    #[msg("Only the queue authority can perform this action.")]
    Unauthorized,

    #[msg("The provided queue account does not match the job's queue field.")]
    InvalidQueue,

    // ── Result errors ──────────────────────────────────────────────────────
    #[msg("Result data exceeds the 128-byte maximum.")]
    ResultTooLarge,
}
