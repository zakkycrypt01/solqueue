#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, Job, JobStatus};
use crate::errors::SolQueueError;

#[derive(Accounts)]
#[instruction(queue_name: String, seq: u64)]
pub struct CloseJob<'info> {
    /// Must be the original job creator to reclaim rent.
    #[account(mut)]
    pub creator: Signer<'info>,

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
        constraint = job.creator == creator.key() @ SolQueueError::Unauthorized,
        // Only allow closing finished jobs
        constraint = (job.status == JobStatus::Completed || job.status == JobStatus::Failed)
            @ SolQueueError::JobNotProcessing,
        close = creator,
    )]
    pub job: Account<'info, Job>,
}

pub fn handler(ctx: Context<CloseJob>, _queue_name: String, seq: u64) -> Result<()> {
    msg!(
        "SolQueue: Job #{} account closed. Rent reclaimed to {}",
        seq,
        ctx.accounts.creator.key()
    );
    Ok(())
}
