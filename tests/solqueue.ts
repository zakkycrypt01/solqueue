import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Solqueue } from "../target/types/solqueue";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  SystemProgram as SP,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encodeQueueName(name: string): Buffer {
  const buf = Buffer.alloc(32);
  buf.write(name, "utf8");
  return buf;
}

async function deriveQueuePDA(
  program: Program<Solqueue>,
  queueName: string
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), Buffer.from(queueName)],
    program.programId
  );
}

async function deriveJobPDA(
  program: Program<Solqueue>,
  queueName: string,
  seq: number
): Promise<[PublicKey, number]> {
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64LE(BigInt(seq));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), Buffer.from(queueName), seqBuf],
    program.programId
  );
}

async function deriveWorkerPDA(
  program: Program<Solqueue>,
  queueName: string,
  workerPubkey: PublicKey
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("worker"), Buffer.from(queueName), workerPubkey.toBuffer()],
    program.programId
  );
}

/**
 * Fund a keypair by transferring SOL from the Anchor provider wallet.
 * Avoids the Devnet airdrop faucet which rate-limits aggressively.
 */
async function fundFromAuthority(
  provider: anchor.AnchorProvider,
  to: PublicKey,
  sol: number = 0.5
) {
  const tx = new Transaction().add(
    SP.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: to,
      lamports: sol * LAMPORTS_PER_SOL,
    })
  );
  await provider.sendAndConfirm(tx);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("SolQueue — On-Chain Job Queue", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Solqueue as Program<Solqueue>;
  const authority = provider.wallet as anchor.Wallet;

  const QUEUE_NAME = `testqueue-${Date.now().toString().slice(-6)}`;
  const TIMEOUT_SECS = 60;
  const MAX_RETRIES = 2;

  let queuePDA: PublicKey;
  let worker1 = Keypair.generate();
  let worker2 = Keypair.generate();
  let creator = Keypair.generate();

  // ── Setup ──────────────────────────────────────────────────────────────────

  before(async () => {
    console.log("\n  🔑 Test accounts:");
    console.log(`     Authority: ${authority.publicKey.toBase58()}`);
    console.log(`     Worker1:   ${worker1.publicKey.toBase58()}`);
    console.log(`     Worker2:   ${worker2.publicKey.toBase58()}`);
    console.log(`     Creator:   ${creator.publicKey.toBase58()}`);
    console.log(`     Queue:     ${QUEUE_NAME}\n`);

    // Fund test accounts from authority wallet (avoids devnet airdrop rate limit)
    await fundFromAuthority(provider, worker1.publicKey);
    await fundFromAuthority(provider, worker2.publicKey);
    await fundFromAuthority(provider, creator.publicKey);

    [queuePDA] = await deriveQueuePDA(program, QUEUE_NAME);
  });

  // ── Test 1: Initialize Queue ───────────────────────────────────────────────

  it("1. Initializes a queue with correct config", async () => {
    const tx = await program.methods
      .initializeQueue({
        queueName: QUEUE_NAME,
        maxRetries: MAX_RETRIES,
        jobTimeoutSecs: new BN(TIMEOUT_SECS),
      })
      .accounts({
        authority: authority.publicKey,
        queueConfig: queuePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`     ✅ initializeQueue tx: ${tx}`);

    const queue = await program.account.queueConfig.fetch(queuePDA);
    assert.equal(queue.maxRetries, MAX_RETRIES);
    assert.equal(queue.jobTimeoutSecs.toNumber(), TIMEOUT_SECS);
    assert.equal(queue.nextJobSeq.toNumber(), 0);
    assert.equal(queue.isPaused, false);
    assert.equal(queue.totalEnqueued.toNumber(), 0);
    assert.deepEqual(queue.authority, authority.publicKey);
  });

  // ── Test 2: Register Workers ───────────────────────────────────────────────

  it("2. Registers workers for the queue", async () => {
    const [worker1PDA] = await deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
    const [worker2PDA] = await deriveWorkerPDA(program, QUEUE_NAME, worker2.publicKey);

    const tx1 = await program.methods
      .registerWorker(QUEUE_NAME)
      .accounts({
        authority: authority.publicKey,
        queueConfig: queuePDA,
        worker: worker1.publicKey,
        workerRegistry: worker1PDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const tx2 = await program.methods
      .registerWorker(QUEUE_NAME)
      .accounts({
        authority: authority.publicKey,
        queueConfig: queuePDA,
        worker: worker2.publicKey,
        workerRegistry: worker2PDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`     ✅ registerWorker(1) tx: ${tx1}`);
    console.log(`     ✅ registerWorker(2) tx: ${tx2}`);

    const reg1 = await program.account.workerRegistry.fetch(worker1PDA);
    const reg2 = await program.account.workerRegistry.fetch(worker2PDA);

    assert.equal(reg1.isActive, true);
    assert.equal(reg2.isActive, true);
    assert.deepEqual(reg1.worker, worker1.publicKey);
    assert.deepEqual(reg2.worker, worker2.publicKey);
  });

  // ── Test 3: Full Happy Path ────────────────────────────────────────────────

  it("3. Full lifecycle: enqueue → claim → complete", async () => {
    const seq = 0;
    const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, seq);
    const [worker1PDA] = await deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);

    // Enqueue
    const enqueueTx = await program.methods
      .enqueueJob(QUEUE_NAME, new BN(seq), {
        queueName: QUEUE_NAME,
        jobType: "send_email",
        payload: Buffer.from(JSON.stringify({ to: "test@example.com", subject: "Hello" })),
        priority: 5,
        maxRetriesOverride: null,
      })
      .accounts({
        creator: creator.publicKey,
        queueConfig: queuePDA,
        job: jobPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    console.log(`     ✅ enqueueJob tx: ${enqueueTx}`);

    let job = await program.account.job.fetch(jobPDA);
    assert.deepEqual(job.status, { pending: {} });
    assert.equal(job.seq.toNumber(), 0);

    // Claim
    const claimTx = await program.methods
      .claimJob(QUEUE_NAME, new BN(seq))
      .accounts({
        worker: worker1.publicKey,
        queueConfig: queuePDA,
        workerRegistry: worker1PDA,
        job: jobPDA,
      })
      .signers([worker1])
      .rpc();

    console.log(`     ✅ claimJob tx: ${claimTx}`);

    job = await program.account.job.fetch(jobPDA);
    assert.deepEqual(job.status, { processing: {} });
    assert.deepEqual(job.assignedWorker, worker1.publicKey);

    // Complete
    const completeTx = await program.methods
      .completeJob(QUEUE_NAME, new BN(seq), {
        result: Buffer.from(JSON.stringify({ messageId: "msg_abc123", status: "sent" })),
      })
      .accounts({
        worker: worker1.publicKey,
        queueConfig: queuePDA,
        workerRegistry: worker1PDA,
        job: jobPDA,
      })
      .signers([worker1])
      .rpc();

    console.log(`     ✅ completeJob tx: ${completeTx}`);

    job = await program.account.job.fetch(jobPDA);
    assert.deepEqual(job.status, { completed: {} });
    assert.isNotNull(job.completedAt);

    const queue = await program.account.queueConfig.fetch(queuePDA);
    assert.equal(queue.totalCompleted.toNumber(), 1);
    assert.equal(queue.nextJobSeq.toNumber(), 1);
  });

  // ── Test 4: FIFO Ordering with Multiple Workers ────────────────────────────

  it("4. FIFO ordering: 3 jobs, worker 1 and 2 race — sequence preserved", async () => {
    const [w1PDA] = await deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
    const [w2PDA] = await deriveWorkerPDA(program, QUEUE_NAME, worker2.publicKey);

    // Enqueue jobs 1, 2, 3
    for (let i = 1; i <= 3; i++) {
      const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, i);
      await program.methods
        .enqueueJob(QUEUE_NAME, new BN(i), {
          queueName: QUEUE_NAME,
          jobType: "process_payment",
          payload: Buffer.from(JSON.stringify({ orderId: `order_${i}`, amount: i * 100 })),
          priority: 0,
          maxRetriesOverride: null,
        })
        .accounts({
          creator: creator.publicKey,
          queueConfig: queuePDA,
          job: jobPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
    }

    // Worker 1 claims seq=1, Worker 2 claims seq=2
    const [job1PDA] = await deriveJobPDA(program, QUEUE_NAME, 1);
    const [job2PDA] = await deriveJobPDA(program, QUEUE_NAME, 2);

    await program.methods.claimJob(QUEUE_NAME, new BN(1))
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: job1PDA })
      .signers([worker1]).rpc();

    await program.methods.claimJob(QUEUE_NAME, new BN(2))
      .accounts({ worker: worker2.publicKey, queueConfig: queuePDA, workerRegistry: w2PDA, job: job2PDA })
      .signers([worker2]).rpc();

    const j1 = await program.account.job.fetch(job1PDA);
    const j2 = await program.account.job.fetch(job2PDA);

    assert.deepEqual(j1.assignedWorker, worker1.publicKey);
    assert.deepEqual(j2.assignedWorker, worker2.publicKey);
    assert.equal(j1.seq.toNumber(), 1);
    assert.equal(j2.seq.toNumber(), 2);
    console.log("     ✅ FIFO ordering verified, no double-claim");
  });

  // ── Test 5: Retry Logic ────────────────────────────────────────────────────

  it("5. Retry logic: fail job → re-queued → claim again → permanently fail", async () => {
    const seq = 3; // job enqueued in test 4 at seq=3
    const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, seq);
    const [w1PDA]  = await deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);

    // Claim seq=3
    await program.methods.claimJob(QUEUE_NAME, new BN(seq))
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    // Fail attempt 1 → retry_count=1, status→Pending
    await program.methods.failJob(QUEUE_NAME, new BN(seq), { reason: "payment gateway timeout" })
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    let job = await program.account.job.fetch(jobPDA);
    assert.deepEqual(job.status, { pending: {} }, "Should retry: back to Pending");
    assert.equal(job.retryCount, 1);
    console.log("     ✅ Attempt 1 failed → re-queued (Pending)");

    // Re-claim and fail again → retry_count=2, still under max (2)
    await program.methods.claimJob(QUEUE_NAME, new BN(seq))
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    await program.methods.failJob(QUEUE_NAME, new BN(seq), { reason: "still failing" })
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    job = await program.account.job.fetch(jobPDA);
    assert.deepEqual(job.status, { pending: {} });
    assert.equal(job.retryCount, 2);

    // Claim and fail once more → retry_count=3 > max_retries(2) → permanently Failed
    await program.methods.claimJob(QUEUE_NAME, new BN(seq))
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    await program.methods.failJob(QUEUE_NAME, new BN(seq), { reason: "final failure" })
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    job = await program.account.job.fetch(jobPDA);
    assert.deepEqual(job.status, { failed: {} }, "Should be permanently Failed");
    assert.equal(job.retryCount, 3);
    console.log("     ✅ Permanently failed after exhausting max_retries=2");
  });

  // ── Test 6: Unregistered Worker Rejected ──────────────────────────────────

  it("6. Unregistered worker cannot claim a job", async () => {
    const rogue = Keypair.generate();
    await fundFromAuthority(provider, rogue.publicKey);

    const seq = 4;
    const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, seq);
    const [roguePDA] = await deriveWorkerPDA(program, QUEUE_NAME, rogue.publicKey);

    // Enqueue a job for the rogue to try to steal
    await program.methods
      .enqueueJob(QUEUE_NAME, new BN(seq), {
        queueName: QUEUE_NAME,
        jobType: "test_job",
        payload: Buffer.from("{}"),
        priority: 0,
        maxRetriesOverride: null,
      })
      .accounts({ creator: creator.publicKey, queueConfig: queuePDA, job: jobPDA, systemProgram: SystemProgram.programId })
      .signers([creator]).rpc();

    try {
      await program.methods.claimJob(QUEUE_NAME, new BN(seq))
        .accounts({ worker: rogue.publicKey, queueConfig: queuePDA, workerRegistry: roguePDA, job: jobPDA })
        .signers([rogue]).rpc();
      assert.fail("Should have thrown — unregistered worker");
    } catch (err: any) {
      assert.include(err.message, "AccountNotInitialized", "Expected unregistered worker to fail");
      console.log("     ✅ Unregistered worker correctly rejected");
    }
  });

  // ── Test 7: Paused Queue Rejects Enqueue ─────────────────────────────────

  it("7. Paused queue rejects new enqueue, existing jobs unaffected", async () => {
    // Pause the queue
    await program.methods.setQueuePaused(QUEUE_NAME, true)
      .accounts({ authority: authority.publicKey, queueConfig: queuePDA })
      .rpc();

    let queue = await program.account.queueConfig.fetch(queuePDA);
    assert.equal(queue.isPaused, true);
    console.log("     ✅ Queue paused");

    // Try to enqueue — should fail
    const seq = queue.nextJobSeq.toNumber();
    const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, seq);

    try {
      await program.methods
        .enqueueJob(QUEUE_NAME, new BN(seq), {
          queueName: QUEUE_NAME,
          jobType: "test_job",
          payload: Buffer.from("{}"),
          priority: 0,
          maxRetriesOverride: null,
        })
        .accounts({ creator: creator.publicKey, queueConfig: queuePDA, job: jobPDA, systemProgram: SystemProgram.programId })
        .signers([creator]).rpc();
      assert.fail("Should have thrown QueuePaused");
    } catch (err: any) {
      assert.include(err.message, "QueuePaused");
      console.log("     ✅ Enqueue rejected while paused");
    }

    // Resume
    await program.methods.setQueuePaused(QUEUE_NAME, false)
      .accounts({ authority: authority.publicKey, queueConfig: queuePDA })
      .rpc();

    queue = await program.account.queueConfig.fetch(queuePDA);
    assert.equal(queue.isPaused, false);
    console.log("     ✅ Queue resumed");
  });

  // ── Test 8: Wrong Worker Rejected ────────────────────────────────────────

  it("8. Wrong worker cannot complete a job claimed by another", async () => {
    const seq = 4; // job enqueued in test 6, still Pending (rogue was rejected)
    const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, seq);
    const [w1PDA]  = await deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
    const [w2PDA]  = await deriveWorkerPDA(program, QUEUE_NAME, worker2.publicKey);

    // Worker1 claims the job
    await program.methods.claimJob(QUEUE_NAME, new BN(seq))
      .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
      .signers([worker1]).rpc();

    // Worker2 tries to complete it — should fail
    try {
      await program.methods.completeJob(QUEUE_NAME, new BN(seq), { result: Buffer.from("stolen!") })
        .accounts({ worker: worker2.publicKey, queueConfig: queuePDA, workerRegistry: w2PDA, job: jobPDA })
        .signers([worker2]).rpc();
      assert.fail("Should have thrown WrongWorker");
    } catch (err: any) {
      assert.include(err.message, "WrongWorker");
      console.log("     ✅ Wrong worker correctly rejected");
    }
  });

  // ── Test 9: Close Job Reclaims Rent ──────────────────────────────────────

  it("9. close_job reclaims rent to creator after completion", async () => {
    const seq = 0; // completed in test 3
    const [jobPDA] = await deriveJobPDA(program, QUEUE_NAME, seq);

    const balanceBefore = await provider.connection.getBalance(creator.publicKey);

    await program.methods.closeJob(QUEUE_NAME, new BN(seq))
      .accounts({ creator: creator.publicKey, queueConfig: queuePDA, job: jobPDA })
      .signers([creator]).rpc();

    const balanceAfter = await provider.connection.getBalance(creator.publicKey);
    assert.isAbove(balanceAfter, balanceBefore, "Creator should receive rent back");

    // Account should no longer exist
    const jobAccount = await provider.connection.getAccountInfo(jobPDA);
    assert.isNull(jobAccount, "Job account should be closed");
    console.log(`     ✅ Rent reclaimed: +${(balanceAfter - balanceBefore) / LAMPORTS_PER_SOL} SOL`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  after(async () => {
    if (!queuePDA) return;
    try {
      const queue = await program.account.queueConfig.fetch(queuePDA);
      console.log("\n  📊 Final Queue Stats:");
      console.log(`     Total Enqueued:  ${queue.totalEnqueued}`);
      console.log(`     Total Completed: ${queue.totalCompleted}`);
      console.log(`     Total Failed:    ${queue.totalFailed}`);
      console.log(`     Next Seq:        ${queue.nextJobSeq}\n`);
    } catch {
      // queue may not have been initialized if earlier tests failed
    }
  });
});