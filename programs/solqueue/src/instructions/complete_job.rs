#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, Job, JobStatus, WorkerRegistry};
use crate::errors::SolQueueError;
use crate::events::JobCompleted;

#[derive(Accounts)]
#[instruction(queue_name: String, seq: u64)]
pub struct CompleteJob<'info> {
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
pub struct CompleteJobParams {
    pub result: Vec<u8>,
}

pub fn handler(ctx: Context<CompleteJob>, _queue_name: String, _seq: u64, params: CompleteJobParams) -> Result<()> {
    let job      = &mut ctx.accounts.job;
    let queue    = &mut ctx.accounts.queue_config;
    let registry = &mut ctx.accounts.worker_registry;
    let clock    = Clock::get()?;

    require!(job.status == JobStatus::Processing, SolQueueError::JobNotProcessing);
    require!(
        job.assigned_worker == Some(ctx.accounts.worker.key()),
        SolQueueError::WrongWorker
    );
    require!(params.result.len() <= 128, SolQueueError::ResultTooLarge);

    let duration = clock.unix_timestamp - job.started_at.unwrap_or(clock.unix_timestamp);

    // Store result
    let mut result_arr = [0u8; 128];
    result_arr[..params.result.len()].copy_from_slice(&params.result);
    job.result     = result_arr;
    job.result_len = params.result.len() as u8;

    // Transition: Processing → Completed
    job.status       = JobStatus::Completed;
    job.completed_at = Some(clock.unix_timestamp);

    // Update stats
    queue.total_completed    += 1;
    registry.jobs_completed  += 1;

    emit!(JobCompleted {
        job:           job.key(),
        seq:           job.seq,
        worker:        ctx.accounts.worker.key(),
        duration_secs: duration,
        timestamp:     clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Job #{} completed by worker {} in {}s",
        job.seq,
        ctx.accounts.worker.key(),
        duration
    );

    Ok(())
}
