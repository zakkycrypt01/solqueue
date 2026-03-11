#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, Job, JobStatus, WorkerRegistry};
use crate::errors::SolQueueError;
use crate::events::JobClaimed;

#[derive(Accounts)]
#[instruction(queue_name: String, seq: u64)]
pub struct ClaimJob<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    #[account(
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    /// Worker must be registered AND active for this queue.
    #[account(
        mut,
        seeds = [b"worker", queue_name.as_bytes(), worker.key().as_ref()],
        bump = worker_registry.bump,
        constraint = worker_registry.queue == queue_config.key() @ SolQueueError::InvalidQueue,
        constraint = worker_registry.is_active @ SolQueueError::WorkerDeactivated,
    )]
    pub worker_registry: Account<'info, WorkerRegistry>,

    /// The specific job to claim, identified by seq number.
    /// Solana's account locking guarantees this is atomic — no two transactions
    /// can mutate this account simultaneously, preventing double-claims.
    #[account(
        mut,
        seeds = [b"job", queue_name.as_bytes(), &seq.to_le_bytes()],
        bump = job.bump,
        constraint = job.queue == queue_config.key() @ SolQueueError::InvalidQueue,
    )]
    pub job: Account<'info, Job>,
}

pub fn handler(ctx: Context<ClaimJob>, _queue_name: String, _seq: u64) -> Result<()> {
    let job      = &mut ctx.accounts.job;
    let registry = &mut ctx.accounts.worker_registry;
    let clock    = Clock::get()?;

    // Guard: job must be Pending. If another worker claimed it first,
    // this check fails — Solana's serialized account access makes this safe.
    require!(job.status == JobStatus::Pending, SolQueueError::JobNotPending);

    // Transition: Pending → Processing
    job.status          = JobStatus::Processing;
    job.assigned_worker = Some(ctx.accounts.worker.key());
    job.started_at      = Some(clock.unix_timestamp);

    registry.jobs_claimed += 1;

    emit!(JobClaimed {
        job:       job.key(),
        seq:       job.seq,
        worker:    ctx.accounts.worker.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Job #{} claimed by worker {}",
        job.seq,
        ctx.accounts.worker.key()
    );

    Ok(())
}
