#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, WorkerRegistry};
use crate::errors::SolQueueError;
use crate::events::WorkerDeactivated as WorkerDeactivatedEvent;

#[derive(Accounts)]
#[instruction(queue_name: String)]
pub struct DeactivateWorker<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
        has_one = authority @ SolQueueError::Unauthorized,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    /// CHECK: validated by PDA seeds
    pub worker: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"worker", queue_name.as_bytes(), worker.key().as_ref()],
        bump = worker_registry.bump,
        constraint = worker_registry.queue == queue_config.key() @ SolQueueError::InvalidQueue,
    )]
    pub worker_registry: Account<'info, WorkerRegistry>,
}

pub fn handler(ctx: Context<DeactivateWorker>, _queue_name: String) -> Result<()> {
    let registry = &mut ctx.accounts.worker_registry;
    let clock = Clock::get()?;

    registry.is_active = false;

    emit!(WorkerDeactivatedEvent {
        queue: ctx.accounts.queue_config.key(),
        worker: ctx.accounts.worker.key(),
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Worker {} deactivated on queue '{}'",
        ctx.accounts.worker.key(),
        ctx.accounts.queue_config.name_str()
    );

    Ok(())
}
