#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::state::{QueueConfig, name_to_bytes};
use crate::events::QueuePauseToggled;

#[derive(Accounts)]
#[instruction(queue_name: String)]
pub struct InitializeQueue<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = QueueConfig::LEN,
        seeds = [b"queue", queue_name.as_bytes()],
        bump,
    )]
    pub queue_config: Account<'info, QueueConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeQueueParams {
    pub queue_name: String,
    pub max_retries: u8,
    pub job_timeout_secs: i64,
}

pub fn handler(ctx: Context<InitializeQueue>, params: InitializeQueueParams) -> Result<()> {
    let queue = &mut ctx.accounts.queue_config;
    let clock = Clock::get()?;

    queue.authority = ctx.accounts.authority.key();
    queue.queue_name = name_to_bytes(&params.queue_name)?;
    queue.next_job_seq = 0;
    queue.total_enqueued = 0;
    queue.total_completed = 0;
    queue.total_failed = 0;
    queue.is_paused = false;
    queue.max_retries = params.max_retries;
    queue.job_timeout_secs = params.job_timeout_secs;
    queue.bump = ctx.bumps.queue_config;

    emit!(QueuePauseToggled {
        queue: queue.key(),
        is_paused: false,
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "SolQueue: Initialized queue '{}' with max_retries={} timeout={}s",
        params.queue_name,
        params.max_retries,
        params.job_timeout_secs
    );

    Ok(())
}
