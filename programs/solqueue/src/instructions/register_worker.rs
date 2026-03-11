#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, WorkerRegistry};
use crate::errors::SolQueueError;
use crate::events::WorkerRegistered;

#[derive(Accounts)]
#[instruction(queue_name: String)]
pub struct RegisterWorker<'info> {
    /// Queue authority must authorize new workers.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
        has_one = authority @ SolQueueError::Unauthorized,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    /// The pubkey that will sign claim/complete/fail instructions.
    /// CHECK: Validated by PDA seed derivation below.
    pub worker: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = WorkerRegistry::LEN,
        seeds = [b"worker", queue_name.as_bytes(), worker.key().as_ref()],
        bump,
    )]
    pub worker_registry: Account<'info, WorkerRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterWorker>, _queue_name: String) -> Result<()> {
    let registry = &mut ctx.accounts.worker_registry;
    let clock = Clock::get()?;

    registry.queue = ctx.accounts.queue_config.key();
    registry.worker = ctx.accounts.worker.key();
    registry.registered_at = clock.unix_timestamp;
    registry.jobs_completed = 0;
    registry.jobs_failed = 0;
    registry.jobs_claimed = 0;
    registry.is_active = true;
    registry.bump = ctx.bumps.worker_registry;

    emit!(WorkerRegistered {
        queue: ctx.accounts.queue_config.key(),
        worker: ctx.accounts.worker.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Worker {} registered for queue '{}'",
        ctx.accounts.worker.key(),
        ctx.accounts.queue_config.name_str()
    );

    Ok(())
}
