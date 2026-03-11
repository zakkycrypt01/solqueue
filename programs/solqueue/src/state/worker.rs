use anchor_lang::prelude::*;

/// Tracks a registered worker for a specific queue.
/// PDA seeds: [b"worker", queue_name, worker_pubkey]
#[account]
#[derive(Debug)]
pub struct WorkerRegistry {
    /// Queue this worker is registered to.
    pub queue: Pubkey,

    /// The worker's signing keypair pubkey.
    pub worker: Pubkey,

    /// Timestamp of registration.
    pub registered_at: i64,

    /// Reputation metrics — used for the worker leaderboard.
    pub jobs_completed: u64,
    pub jobs_failed: u64,
    pub jobs_claimed: u64,

    /// Queue authority can set this to false to deactivate a rogue worker.
    pub is_active: bool,

    /// Canonical PDA bump.
    pub bump: u8,
}

impl WorkerRegistry {
    /// Space:
    /// discriminator(8) + queue(32) + worker(32) + registered_at(8)
    /// + jobs_completed(8) + jobs_failed(8) + jobs_claimed(8)
    /// + is_active(1) + bump(1)
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;

    pub fn completion_rate(&self) -> f64 {
        if self.jobs_claimed == 0 {
            return 0.0;
        }
        self.jobs_completed as f64 / self.jobs_claimed as f64
    }
}
