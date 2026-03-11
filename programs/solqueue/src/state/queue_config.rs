use anchor_lang::prelude::*;

/// Root authority account for a named job queue.
/// PDA seeds: [b"queue", queue_name]
#[account]
#[derive(Debug)]
pub struct QueueConfig {
    /// The authority who can register/deactivate workers and pause the queue.
    pub authority: Pubkey,

    /// Human-readable queue name, null-padded to 32 bytes. Used as PDA seed.
    pub queue_name: [u8; 32],

    /// Monotonically increasing sequence counter.
    /// The next job enqueued will get this value, then it increments.
    pub next_job_seq: u64,

    /// Lifetime counters for observability.
    pub total_enqueued: u64,
    pub total_completed: u64,
    pub total_failed: u64,

    /// Circuit breaker — when true, enqueue_job is rejected.
    pub is_paused: bool,

    /// Default max retries for jobs in this queue (workers may override per-job).
    pub max_retries: u8,

    /// Job processing timeout in seconds. After this, anyone can call expire_job.
    pub job_timeout_secs: i64,

    /// Canonical PDA bump, stored for cheap CPI derivation.
    pub bump: u8,
}

impl QueueConfig {
    /// Space calculation:
    /// discriminator(8) + pubkey(32) + name(32) + seq(8) + 3x counters(24)
    /// + paused(1) + max_retries(1) + timeout(8) + bump(1) = 115
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 8 + 1;

    /// Returns the queue name as a utf8 string, trimming null bytes.
    pub fn name_str(&self) -> &str {
        let end = self.queue_name.iter().position(|&b| b == 0).unwrap_or(32);
        std::str::from_utf8(&self.queue_name[..end]).unwrap_or("?")
    }
}

/// Converts a string name (≤32 chars) into a fixed [u8;32] array.
pub fn name_to_bytes(name: &str) -> Result<[u8; 32]> {
    let bytes = name.as_bytes();
    require!(bytes.len() <= 32, crate::errors::SolQueueError::QueueNameTooLong);
    let mut arr = [0u8; 32];
    arr[..bytes.len()].copy_from_slice(bytes);
    Ok(arr)
}
