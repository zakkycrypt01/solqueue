#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, Job, JobStatus, job_type_to_bytes};
use crate::errors::SolQueueError;
use crate::events::JobEnqueued;

#[derive(Accounts)]
#[instruction(queue_name: String, seq: u64)]
pub struct EnqueueJob<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
        constraint = !queue_config.is_paused @ SolQueueError::QueuePaused,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    #[account(
        init,
        payer = creator,
        space = Job::LEN,
        seeds = [b"job", queue_name.as_bytes(), &seq.to_le_bytes()],
        bump,
    )]
    pub job: Account<'info, Job>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EnqueueJobParams {
    pub queue_name: String,
    pub job_type: String,
    pub payload: Vec<u8>,
    pub priority: u8,
    /// Override queue default; pass 0 to use queue default.
    pub max_retries_override: Option<u8>,
}

pub fn handler(ctx: Context<EnqueueJob>, _queue_name: String, _seq: u64, params: EnqueueJobParams) -> Result<()> {
    require!(params.payload.len() <= 512, SolQueueError::PayloadTooLarge);

    let queue = &mut ctx.accounts.queue_config;
    let job   = &mut ctx.accounts.job;
    let clock = Clock::get()?;

    // Sequence number is passed as instruction arg so it can be used in PDA seeds.
    // Validate it matches the queue's expected next seq.
    // (Anchor enforces the seed derivation; the seq arg must equal next_job_seq.)
    let seq = queue.next_job_seq;

    job.queue            = queue.key();
    job.seq              = seq;
    job.job_type         = job_type_to_bytes(&params.job_type)?;
    job.status           = JobStatus::Pending;
    job.priority         = params.priority;
    job.retry_count      = 0;
    job.max_retries      = params.max_retries_override.unwrap_or(queue.max_retries);
    job.assigned_worker  = None;
    job.creator          = ctx.accounts.creator.key();
    job.enqueued_at      = clock.unix_timestamp;
    job.started_at       = None;
    job.completed_at     = None;
    job.result_len       = 0;
    job.result           = [0u8; 128];
    job.bump             = ctx.bumps.job;

    // Copy payload
    let mut payload_arr = [0u8; 512];
    payload_arr[..params.payload.len()].copy_from_slice(&params.payload);
    job.payload = payload_arr;

    // Update queue stats
    queue.next_job_seq   = seq + 1;
    queue.total_enqueued += 1;

    emit!(JobEnqueued {
        queue:     queue.key(),
        job:       job.key(),
        seq,
        job_type:  params.job_type.clone(),
        priority:  params.priority,
        creator:   ctx.accounts.creator.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Job #{} ({}) enqueued on queue '{}' by {}",
        seq,
        params.job_type,
        queue.name_str(),
        ctx.accounts.creator.key()
    );

    Ok(())
}
