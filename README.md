# ⚙️ SolQueue — On-Chain Job Queue

> **Solana Challenge Submission** · Rebuild Backend Systems as On-Chain Rust Programs

A production-grade job queue implemented entirely on Solana. No Redis. No servers. Just math.

[![Devnet Program](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana)](https://explorer.solana.com/address/SoLQueueXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?cluster=devnet)

---

## 📖 Architecture: How This Works in Web2

In a traditional backend, a job queue consists of:

```
Producer API  →  Redis (broker)  →  Worker Pool  →  Dead Letter Queue
    │                  │                 │
  Express            Bull/Celery       Node.js processes
  Lambda             RabbitMQ          Celery workers
  FastAPI            SQS               Sidekiq
```

**Key Web2 assumptions:**
- A **trusted central broker** (Redis) holds authoritative job state
- Workers authenticate with **shared secrets or IAM roles**
- The broker's **BRPOPLPUSH** operation atomically prevents double-claims
- Job history is **ephemeral** — stored with a TTL, then deleted
- **Fixed infrastructure cost** regardless of throughput

---

## 🔗 Architecture: How This Works on Solana

SolQueue replaces every component with on-chain equivalents:

```
                    ┌──────────────────────────────────────┐
                    │         Solana Program (BPF)         │
                    │            solqueue.so               │
                    └──────────────┬───────────────────────┘
                                   │ owns/validates
              ┌────────────────────┼────────────────────┐
              │                    │                    │
    ┌─────────▼──────────┐ ┌──────▼──────────┐ ┌──────▼──────────┐
    │   QueueConfig PDA  │ │    Job PDA       │ │  Worker PDA     │
    │ seeds: ["queue",   │ │ seeds: ["job",   │ │ seeds: ["worker"│
    │         name]      │ │  name, seq_le]   │ │  name, worker]  │
    │                    │ │                  │ │                 │
    │ · authority        │ │ · queue (pubkey) │ │ · queue         │
    │ · next_job_seq     │ │ · seq (u64)      │ │ · worker        │
    │ · total_enqueued   │ │ · job_type       │ │ · is_active     │
    │ · total_completed  │ │ · payload [512b] │ │ · jobs_completed│
    │ · is_paused        │ │ · status (enum)  │ │ · jobs_failed   │
    │ · max_retries      │ │ · priority       │ └─────────────────┘
    └────────────────────┘ │ · retry_count    │
                           │ · assigned_worker│
                           │ · timestamps     │
                           └──────────────────┘
```

### Job State Machine

```
enqueue_job          claim_job           complete_job
    │                    │                    │
    ▼                    ▼                    ▼
 Pending ──────────► Processing ──────────► Completed
    ▲                    │
    │    fail_job        │ fail_job
    │  (retry_count      │ (retry_count
    │   < max_retries)   │  >= max_retries)
    └────────────────────┤
                         ▼
                       Failed

    Processing ──────► Pending  (expire_job, when worker crashes)
```

### How Anti-Double-Claim Works

In Redis, `BRPOPLPUSH` is atomic at the Redis server level.

In Solana, **account-level write locks** provide the same guarantee. When two workers
race to call `claim_job` on the same job account:

1. Both transactions land in the same block
2. Solana serializes them — one executes first
3. The first worker sets `status = Processing`
4. The second worker's transaction reads `status = Processing` and fails with `JobNotPending`

No mutex. No broker. The runtime provides this atomicity for free.

---

## ⚖️ Tradeoffs & Constraints

| Property | Web2 (Redis/Bull) | SolQueue | Notes |
|----------|------------------|----------|-------|
| **Throughput** | 100k+ jobs/sec | ~1k jobs/sec | Limited by Solana TPS |
| **Latency** | <1ms | ~400ms | One Solana slot |
| **Payload size** | Unlimited | 512 bytes | Store large data off-chain |
| **Cost** | Fixed infra | ~0.002 SOL/job | Reclaim with close_job |
| **Privacy** | Private by default | Public state | Encrypt payload off-chain |
| **Trust** | Trust Redis operator | Trustless | Math enforces correctness |
| **Auditability** | Volatile logs | Immutable ledger | Every transition forever |
| **Worker auth** | Secrets / IAM | Ed25519 keypairs | Cryptographic proof |
| **Availability** | Redis SLA | Solana validators | ~99.9% uptime |
| **Ordering** | Redis list (FIFO) | Sequence numbers | Deterministic FIFO |

### When would you actually use SolQueue?

✅ **Good fit:**
- DeFi settlement queues — trustless, auditable, multi-party execution
- DAO governance execution — on-chain votes trigger on-chain jobs
- NFT minting pipelines — provable fairness in order of execution
- Cross-organization workflows — no shared trusted server needed
- Payment processor queues — immutable audit trail of every state change

❌ **Poor fit:**
- High-throughput processing (>1k jobs/sec)
- Large payload jobs (use off-chain store + hash)
- Private business logic (all state is public)
- Sub-100ms latency requirements

---

## 🚀 Quick Start

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

# Configure Devnet
solana config set --url devnet
solana-keygen new  # creates ~/.config/solana/id.json
solana airdrop 2   # fund your wallet
```

### Build & Deploy

```bash
git clone https://github.com/your-org/solqueue
cd solqueue
npm install

# Build the Anchor program
anchor build

# Run tests against localnet
anchor test

# Deploy to Devnet
anchor deploy --provider.cluster devnet

# Update the program ID in Anchor.toml and lib.rs with the deployed ID
```

### Using the CLI

```bash
cd client/cli && npm install && npm run build

# Initialize a queue
solqueue init my-queue --max-retries 3 --timeout 300

# Register a worker
solqueue worker-register my-queue

# Enqueue a job
solqueue enqueue my-queue send_email '{"to":"user@example.com","subject":"Hello"}'

# Claim the job (run as the worker keypair)
solqueue claim my-queue 0

# Complete it
solqueue complete my-queue 0 '{"messageId":"msg_abc","status":"sent"}'

# View job status
solqueue status my-queue 0

# Dashboard overview
solqueue dashboard my-queue
```

### Running the Dashboard

```bash
cd client/dashboard
npm install
npm run dev
# Open http://localhost:5173
```

---

## 📁 Project Structure

```
solqueue/
├── programs/solqueue/src/
│   ├── lib.rs                    # Program entry point
│   ├── state/
│   │   ├── queue_config.rs       # QueueConfig account
│   │   ├── job.rs                # Job account + JobStatus enum
│   │   └── worker.rs             # WorkerRegistry account
│   ├── instructions/
│   │   ├── initialize_queue.rs
│   │   ├── register_worker.rs
│   │   ├── deactivate_worker.rs
│   │   ├── enqueue_job.rs
│   │   ├── claim_job.rs          # ← atomic anti-double-claim
│   │   ├── complete_job.rs
│   │   ├── fail_job.rs           # ← retry logic
│   │   ├── expire_job.rs         # ← worker crash recovery
│   │   ├── pause_queue.rs        # ← circuit breaker
│   │   └── close_job.rs          # ← rent reclaim
│   ├── errors.rs                 # 15 custom error codes
│   └── events.rs                 # Anchor events for indexing
├── tests/
│   └── solqueue.ts               # 9-scenario Anchor test suite
├── client/
│   ├── cli/                      # TypeScript CLI
│   └── dashboard/                # React dashboard (Vite)
└── README.md
```

---

## 🧪 Test Scenarios

| # | Scenario | Validates |
|---|----------|-----------|
| 1 | Initialize queue | Config, PDA derivation, event emission |
| 2 | Register workers | Authority check, worker PDA creation |
| 3 | Full happy path | enqueue → claim → complete lifecycle |
| 4 | FIFO ordering | Sequence numbers, 3 jobs, 2 workers racing |
| 5 | Retry logic | fail → re-queue → fail again → permanent fail |
| 6 | Unregistered worker | AccountNotInitialized rejection |
| 7 | Paused queue | QueuePaused error, resume, re-enqueue succeeds |
| 8 | Wrong worker | WrongWorker error on cross-worker complete |
| 9 | Rent reclaim | close_job closes account, balance returns |

```bash
anchor test
# ✅ 9 passing
```

---

## 🔗 Devnet Transaction Links

| Instruction | Transaction |
|-------------|------------|
| initialize_queue | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_1?cluster=devnet) |
| register_worker  | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_2?cluster=devnet) |
| enqueue_job      | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_3?cluster=devnet) |
| claim_job        | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_4?cluster=devnet) |
| complete_job     | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_5?cluster=devnet) |
| fail_job         | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_6?cluster=devnet) |
| expire_job       | [View on Explorer](https://explorer.solana.com/tx/REPLACE_TX_7?cluster=devnet) |

> Update these links after running `anchor deploy` and the test suite against Devnet.

---

## 📄 License

MIT
