use anchor_lang::prelude::*;

/// Emitted when a new job is enqueued.
#[event]
pub struct JobEnqueued {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub seq: u64,
    pub job_type: String,
    pub priority: u8,
    pub creator: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a worker claims a job.
#[event]
pub struct JobClaimed {
    pub job: Pubkey,
    pub seq: u64,
    pub worker: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a job completes successfully.
#[event]
pub struct JobCompleted {
    pub job: Pubkey,
    pub seq: u64,
    pub worker: Pubkey,
    pub duration_secs: i64,
    pub timestamp: i64,
}

/// Emitted when a job fails (either retry or permanent failure).
#[event]
pub struct JobFailed {
    pub job: Pubkey,
    pub seq: u64,
    pub worker: Pubkey,
    pub retry_count: u8,
    pub permanent: bool,
    pub timestamp: i64,
}

/// Emitted when a stale Processing job is expired.
#[event]
pub struct JobExpired {
    pub job: Pubkey,
    pub seq: u64,
    pub previous_worker: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a queue is paused or unpaused.
#[event]
pub struct QueuePauseToggled {
    pub queue: Pubkey,
    pub is_paused: bool,
    pub authority: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a worker is registered.
#[event]
pub struct WorkerRegistered {
    pub queue: Pubkey,
    pub worker: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a worker is deactivated by queue authority.
#[event]
pub struct WorkerDeactivated {
    pub queue: Pubkey,
    pub worker: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}
