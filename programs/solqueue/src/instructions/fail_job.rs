#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, Job, JobStatus, WorkerRegistry};
use crate::errors::SolQueueError;
use crate::events::JobFailed;

#[derive(Accounts)]
#[instruction(queue_name: String, seq: u64)]
pub struct FailJob<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    #[account(
        mut,
        seeds = [b"worker", queue_name.as_bytes(), worker.key().as_ref()],
        bump = worker_registry.bump,
        constraint = worker_registry.queue == queue_config.key() @ SolQueueError::InvalidQueue,
        constraint = worker_registry.is_active @ SolQueueError::WorkerDeactivated,
    )]
    pub worker_registry: Account<'info, WorkerRegistry>,

    #[account(
        mut,
        seeds = [b"job", queue_name.as_bytes(), &seq.to_le_bytes()],
        bump = job.bump,
        constraint = job.queue == queue_config.key() @ SolQueueError::InvalidQueue,
    )]
    pub job: Account<'info, Job>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct FailJobParams {
    pub reason: String,
}

pub fn handler(ctx: Context<FailJob>, _queue_name: String, _seq: u64, params: FailJobParams) -> Result<()> {
    let job      = &mut ctx.accounts.job;
    let queue    = &mut ctx.accounts.queue_config;
    let registry = &mut ctx.accounts.worker_registry;
    let clock    = Clock::get()?;

    require!(job.status == JobStatus::Processing, SolQueueError::JobNotProcessing);
    require!(
        job.assigned_worker == Some(ctx.accounts.worker.key()),
        SolQueueError::WrongWorker
    );

    // Store reason in result field
    let reason_bytes = params.reason.as_bytes();
    let copy_len = reason_bytes.len().min(128);
    job.result     = [0u8; 128];
    job.result[..copy_len].copy_from_slice(&reason_bytes[..copy_len]);
    job.result_len = copy_len as u8;

    job.retry_count += 1;
    registry.jobs_failed += 1;

    let permanent = job.retry_count > job.max_retries;

    if permanent {
        // Exhausted retries — permanently failed
        job.status       = JobStatus::Failed;
        job.completed_at = Some(clock.unix_timestamp);
        queue.total_failed += 1;

        msg!(
            "SolQueue: Job #{} permanently failed after {} retries. Reason: {}",
            job.seq,
            job.retry_count,
            params.reason
        );
    } else {
        // Reset for retry — back to Pending
        job.status          = JobStatus::Pending;
        job.assigned_worker = None;
        job.started_at      = None;

        msg!(
            "SolQueue: Job #{} failed (attempt {}/{}). Reason: {}. Re-queued.",
            job.seq,
            job.retry_count,
            job.max_retries + 1,
            params.reason
        );
    }

    emit!(JobFailed {
        job:         job.key(),
        seq:         job.seq,
        worker:      ctx.accounts.worker.key(),
        retry_count: job.retry_count,
        permanent,
        timestamp:   clock.unix_timestamp,
    });

    Ok(())
}
