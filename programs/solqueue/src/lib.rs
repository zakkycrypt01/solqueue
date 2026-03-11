#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod state;
pub mod instructions;

use instructions::*;

declare_id!("EuzHoVFafwymNComWL1K1ehEt4V6d1CpGx5mUqsQP8r4");

#[program]
pub mod solqueue {
    use super::*;

    // ── Queue Management ────────────────────────────────────────────────────

    /// Create a new named job queue. Called once by the authority.
    ///
    /// # Arguments
    /// * `params` - Queue name, max_retries, job_timeout_secs
    pub fn initialize_queue(
        ctx: Context<InitializeQueue>,
        params: InitializeQueueParams,
    ) -> Result<()> {
        instructions::initialize_queue::handler(ctx, params)
    }

    /// Pause or resume a queue. Only the queue authority can call this.
    /// When paused, enqueue_job will be rejected.
    pub fn set_queue_paused(
        ctx: Context<PauseQueue>,
        queue_name: String,
        pause: bool,
    ) -> Result<()> {
        instructions::pause_queue::pause_handler(ctx, queue_name, pause)
    }

    // ── Worker Management ───────────────────────────────────────────────────

    /// Register a worker keypair to process jobs on a queue.
    /// Only the queue authority can register workers.
    pub fn register_worker(
        ctx: Context<RegisterWorker>,
        queue_name: String,
    ) -> Result<()> {
        instructions::register_worker::handler(ctx, queue_name)
    }

    /// Deactivate a registered worker. Only the queue authority can call this.
    /// Deactivated workers cannot claim new jobs.
    pub fn deactivate_worker(
        ctx: Context<DeactivateWorker>,
        queue_name: String,
    ) -> Result<()> {
        instructions::deactivate_worker::handler(ctx, queue_name)
    }

    // ── Job Lifecycle ───────────────────────────────────────────────────────

    /// Enqueue a new job. Any signer can call this (permissionless producer).
    ///
    /// # Arguments
    /// * `seq`    - Must equal queue.next_job_seq at call time (used in PDA seed)
    /// * `params` - Job type, payload bytes, priority, optional retry override
    pub fn enqueue_job(
        ctx: Context<EnqueueJob>,
        queue_name: String,
        seq: u64,
        params: EnqueueJobParams,
    ) -> Result<()> {
        instructions::enqueue_job::handler(ctx, queue_name, seq, params)
    }

    /// Claim a Pending job for processing. Atomic — Solana's account locking
    /// prevents two workers from claiming the same job simultaneously.
    ///
    /// # Arguments
    /// * `seq` - The sequence number of the job to claim
    pub fn claim_job(
        ctx: Context<ClaimJob>,
        queue_name: String,
        seq: u64,
    ) -> Result<()> {
        instructions::claim_job::handler(ctx, queue_name, seq)
    }

    /// Mark a Processing job as successfully Completed.
    /// Only the worker who claimed the job can call this.
    pub fn complete_job(
        ctx: Context<CompleteJob>,
        queue_name: String,
        seq: u64,
        params: CompleteJobParams,
    ) -> Result<()> {
        instructions::complete_job::handler(ctx, queue_name, seq, params)
    }

    /// Report a job as failed. If retry_count < max_retries, the job returns
    /// to Pending for another worker to claim. Otherwise it is permanently Failed.
    /// Only the assigned worker can call this.
    pub fn fail_job(
        ctx: Context<FailJob>,
        queue_name: String,
        seq: u64,
        params: FailJobParams,
    ) -> Result<()> {
        instructions::fail_job::handler(ctx, queue_name, seq, params)
    }

    /// Expire a stale Processing job back to Pending.
    /// Anyone can call this after the queue's job_timeout_secs has elapsed.
    /// This prevents jobs from being permanently stuck when a worker crashes.
    pub fn expire_job(
        ctx: Context<ExpireJob>,
        queue_name: String,
        seq: u64,
    ) -> Result<()> {
        instructions::expire_job::handler(ctx, queue_name, seq)
    }

    /// Close a Completed or Failed job account, reclaiming rent to the creator.
    /// Only the job creator can close their job.
    pub fn close_job(
        ctx: Context<CloseJob>,
        queue_name: String,
        seq: u64,
    ) -> Result<()> {
        instructions::close_job::handler(ctx, queue_name, seq)
    }
}
