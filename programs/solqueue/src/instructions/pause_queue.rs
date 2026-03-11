#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::QueueConfig;
use crate::errors::SolQueueError;
use crate::events::QueuePauseToggled;

// ─── pause_queue ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(queue_name: String)]
pub struct PauseQueue<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"queue", queue_name.as_bytes()],
        bump = queue_config.bump,
        has_one = authority @ SolQueueError::Unauthorized,
    )]
    pub queue_config: Account<'info, QueueConfig>,
}

pub fn pause_handler(ctx: Context<PauseQueue>, _queue_name: String, pause: bool) -> Result<()> {
    let queue = &mut ctx.accounts.queue_config;
    let clock = Clock::get()?;

    queue.is_paused = pause;

    emit!(QueuePauseToggled {
        queue:     queue.key(),
        is_paused: pause,
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Queue '{}' {}",
        queue.name_str(),
        if pause { "PAUSED" } else { "RESUMED" }
    );

    Ok(())
}
