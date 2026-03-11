#![allow(unexpected_cfgs)]
pub mod initialize_queue;
pub mod register_worker;
pub mod deactivate_worker;
pub mod enqueue_job;
pub mod claim_job;
pub mod complete_job;
pub mod fail_job;
pub mod expire_job;
pub mod pause_queue;
pub mod close_job;

// The #[program] macro generates __client_accounts_* structs that require
// these glob re-exports to be in scope. The `handler` name collision is
// harmless — lib.rs calls each handler via its full module path — so we
// suppress the lint rather than break the macro expansion.
#[allow(ambiguous_glob_reexports)]
pub use initialize_queue::*;
#[allow(ambiguous_glob_reexports)]
pub use register_worker::*;
#[allow(ambiguous_glob_reexports)]
pub use deactivate_worker::*;
#[allow(ambiguous_glob_reexports)]
pub use enqueue_job::*;
#[allow(ambiguous_glob_reexports)]
pub use claim_job::*;
#[allow(ambiguous_glob_reexports)]
pub use complete_job::*;
#[allow(ambiguous_glob_reexports)]
pub use fail_job::*;
#[allow(ambiguous_glob_reexports)]
pub use expire_job::*;
#[allow(ambiguous_glob_reexports)]
pub use pause_queue::*;
#[allow(ambiguous_glob_reexports)]
pub use close_job::*;
