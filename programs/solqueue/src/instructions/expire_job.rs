#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, Job, JobStatus};
use crate::errors::SolQueueError;
use crate::events::JobExpired;

#[derive(Accounts)]
#[instruction(queue_name: String, seq: u64)]
pub struct ExpireJob<'info> {
    /// Anyone can call expire_job — no authority required.
    /// This prevents jobs from being permanently stuck when a worker crashes.
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    #[account(
        mut,
        seeds = [b"job", queue_name.as_bytes(), &seq.to_le_bytes()],
        bump = job.bump,
        constraint = job.queue == queue_config.key() @ SolQueueError::InvalidQueue,
    )]
    pub job: Account<'info, Job>,
}

pub fn handler(ctx: Context<ExpireJob>, _queue_name: String, _seq: u64) -> Result<()> {
    let job   = &ctx.accounts.job;
    let queue = &ctx.accounts.queue_config;
    let clock = Clock::get()?;

    require!(
        job.status == JobStatus::Processing,
        SolQueueError::CannotExpireNonProcessingJob
    );

    require!(
        job.is_expired(clock.unix_timestamp, queue.job_timeout_secs),
        SolQueueError::JobNotExpired
    );

    let previous_worker = job.assigned_worker.unwrap_or_default();

    let job = &mut ctx.accounts.job;

    // Reset to Pending so another worker can claim it.
    // retry_count is NOT incremented — expiry is not the worker's fault.
    job.status          = JobStatus::Pending;
    job.assigned_worker = None;
    job.started_at      = None;

    // Write expiry note to result field
    let note = b"expired: worker timeout";
    job.result           = [0u8; 128];
    job.result[..note.len()].copy_from_slice(note);
    job.result_len       = note.len() as u8;

    emit!(JobExpired {
        job:             job.key(),
        seq:             job.seq,
        previous_worker,
        timestamp:       clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Job #{} expired (worker {} timed out). Re-queued.",
        job.seq,
        previous_worker
    );

    Ok(())
}
