use anchor_lang::prelude::*;

/// Status of a job — drives the on-chain state machine.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
    /// Waiting to be claimed by a worker.
    Pending,
    /// Claimed by a worker; currently being processed.
    Processing,
    /// Successfully completed.
    Completed,
    /// Exhausted all retries; permanently failed.
    Failed,
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobStatus::Pending    => write!(f, "Pending"),
            JobStatus::Processing => write!(f, "Processing"),
            JobStatus::Completed  => write!(f, "Completed"),
            JobStatus::Failed     => write!(f, "Failed"),
        }
    }
}

/// A single unit of work. One PDA per job.
/// PDA seeds: [b"job", queue_name, seq.to_le_bytes()]
#[account]
#[derive(Debug)]
pub struct Job {
    /// Parent queue.
    pub queue: Pubkey,

    /// Monotonic sequence number — determines FIFO order.
    pub seq: u64,

    /// Job type discriminator for worker routing (e.g. b"send_email\0...").
    pub job_type: [u8; 32],

    /// Arbitrary payload bytes. Large data should be stored off-chain (Arweave/IPFS)
    /// with only a 32-byte content hash stored here.
    pub payload: [u8; 512],

    /// Current state machine status.
    pub status: JobStatus,

    /// Priority: 0-255. Higher value = processed first among Pending jobs.
    pub priority: u8,

    /// How many times this job has been retried.
    pub retry_count: u8,

    /// Maximum retries before permanently failing.
    pub max_retries: u8,

    /// Worker currently processing this job. None when Pending/Completed/Failed.
    pub assigned_worker: Option<Pubkey>,

    /// Who enqueued this job — rent reclaim target.
    pub creator: Pubkey,

    // ── Timestamps (Unix seconds) ──────────────────────────────────────────
    pub enqueued_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,

    /// Result or error message (up to 128 bytes).
    pub result: [u8; 128],
    pub result_len: u8,

    /// Canonical PDA bump.
    pub bump: u8,
}

impl Job {
    /// Space:
    /// discriminator(8) + queue(32) + seq(8) + job_type(32) + payload(512)
    /// + status(1) + priority(1) + retry_count(1) + max_retries(1)
    /// + assigned_worker(1+32) + creator(32)
    /// + enqueued_at(8) + started_at(1+8) + completed_at(1+8)
    /// + result(128) + result_len(1) + bump(1)
    pub const LEN: usize = 8 + 32 + 8 + 32 + 512 + 1 + 1 + 1 + 1 + 33 + 32 + 8 + 9 + 9 + 128 + 1 + 1;

    pub fn job_type_str(&self) -> &str {
        let end = self.job_type.iter().position(|&b| b == 0).unwrap_or(32);
        std::str::from_utf8(&self.job_type[..end]).unwrap_or("?")
    }

    pub fn result_str(&self) -> &str {
        let len = self.result_len as usize;
        std::str::from_utf8(&self.result[..len]).unwrap_or("?")
    }

    pub fn is_expired(&self, now: i64, timeout_secs: i64) -> bool {
        if self.status != JobStatus::Processing {
            return false;
        }
        match self.started_at {
            Some(started) => now > started + timeout_secs,
            None => false,
        }
    }
}

/// Converts a string job_type (≤32 chars) into fixed [u8;32].
pub fn job_type_to_bytes(s: &str) -> Result<[u8; 32]> {
    let bytes = s.as_bytes();
    require!(bytes.len() <= 32, crate::errors::SolQueueError::JobTypeTooLong);
    let mut arr = [0u8; 32];
    arr[..bytes.len()].copy_from_slice(bytes);
    Ok(arr)
}
