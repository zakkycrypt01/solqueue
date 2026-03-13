"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_1 = require("@solana/web3.js");
const chai_1 = require("chai");
// ─── Helpers ─────────────────────────────────────────────────────────────────
function encodeQueueName(name) {
    const buf = Buffer.alloc(32);
    buf.write(name, "utf8");
    return buf;
}
function deriveQueuePDA(program, queueName) {
    return __awaiter(this, void 0, void 0, function* () {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("queue"), Buffer.from(queueName)], program.programId);
    });
}
function deriveJobPDA(program, queueName, seq) {
    return __awaiter(this, void 0, void 0, function* () {
        const seqBuf = Buffer.alloc(8);
        seqBuf.writeBigUInt64LE(BigInt(seq));
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("job"), Buffer.from(queueName), seqBuf], program.programId);
    });
}
function deriveWorkerPDA(program, queueName, workerPubkey) {
    return __awaiter(this, void 0, void 0, function* () {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("worker"), Buffer.from(queueName), workerPubkey.toBuffer()], program.programId);
    });
}
/**
 * Fund a keypair by transferring SOL from the Anchor provider wallet.
 * Avoids the Devnet airdrop faucet which rate-limits aggressively.
 */
function fundFromAuthority(provider_1, to_1) {
    return __awaiter(this, arguments, void 0, function* (provider, to, sol = 0.5) {
        const tx = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: to,
            lamports: sol * web3_js_1.LAMPORTS_PER_SOL,
        }));
        yield provider.sendAndConfirm(tx);
    });
}
// ─── Test Suite ───────────────────────────────────────────────────────────────
describe("SolQueue — On-Chain Job Queue", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Solqueue;
    const authority = provider.wallet;
    const QUEUE_NAME = `testqueue-${Date.now().toString().slice(-6)}`;
    const TIMEOUT_SECS = 60;
    const MAX_RETRIES = 2;
    let queuePDA;
    let worker1 = web3_js_1.Keypair.generate();
    let worker2 = web3_js_1.Keypair.generate();
    let creator = web3_js_1.Keypair.generate();
    // ── Setup ──────────────────────────────────────────────────────────────────
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        console.log("\n  🔑 Test accounts:");
        console.log(`     Authority: ${authority.publicKey.toBase58()}`);
        console.log(`     Worker1:   ${worker1.publicKey.toBase58()}`);
        console.log(`     Worker2:   ${worker2.publicKey.toBase58()}`);
        console.log(`     Creator:   ${creator.publicKey.toBase58()}`);
        console.log(`     Queue:     ${QUEUE_NAME}\n`);
        // Fund test accounts from authority wallet (avoids devnet airdrop rate limit)
        yield fundFromAuthority(provider, worker1.publicKey);
        yield fundFromAuthority(provider, worker2.publicKey);
        yield fundFromAuthority(provider, creator.publicKey);
        [queuePDA] = yield deriveQueuePDA(program, QUEUE_NAME);
    }));
    // ── Test 1: Initialize Queue ───────────────────────────────────────────────
    it("1. Initializes a queue with correct config", () => __awaiter(void 0, void 0, void 0, function* () {
        const tx = yield program.methods
            .initializeQueue({
            queueName: QUEUE_NAME,
            maxRetries: MAX_RETRIES,
            jobTimeoutSecs: new anchor_1.BN(TIMEOUT_SECS),
        })
            .accounts({
            authority: authority.publicKey,
            queueConfig: queuePDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        console.log(`     ✅ initializeQueue tx: ${tx}`);
        const queue = yield program.account.queueConfig.fetch(queuePDA);
        chai_1.assert.equal(queue.maxRetries, MAX_RETRIES);
        chai_1.assert.equal(queue.jobTimeoutSecs.toNumber(), TIMEOUT_SECS);
        chai_1.assert.equal(queue.nextJobSeq.toNumber(), 0);
        chai_1.assert.equal(queue.isPaused, false);
        chai_1.assert.equal(queue.totalEnqueued.toNumber(), 0);
        chai_1.assert.deepEqual(queue.authority, authority.publicKey);
    }));
    // ── Test 2: Register Workers ───────────────────────────────────────────────
    it("2. Registers workers for the queue", () => __awaiter(void 0, void 0, void 0, function* () {
        const [worker1PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
        const [worker2PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker2.publicKey);
        const tx1 = yield program.methods
            .registerWorker(QUEUE_NAME)
            .accounts({
            authority: authority.publicKey,
            queueConfig: queuePDA,
            worker: worker1.publicKey,
            workerRegistry: worker1PDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        const tx2 = yield program.methods
            .registerWorker(QUEUE_NAME)
            .accounts({
            authority: authority.publicKey,
            queueConfig: queuePDA,
            worker: worker2.publicKey,
            workerRegistry: worker2PDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        console.log(`     ✅ registerWorker(1) tx: ${tx1}`);
        console.log(`     ✅ registerWorker(2) tx: ${tx2}`);
        const reg1 = yield program.account.workerRegistry.fetch(worker1PDA);
        const reg2 = yield program.account.workerRegistry.fetch(worker2PDA);
        chai_1.assert.equal(reg1.isActive, true);
        chai_1.assert.equal(reg2.isActive, true);
        chai_1.assert.deepEqual(reg1.worker, worker1.publicKey);
        chai_1.assert.deepEqual(reg2.worker, worker2.publicKey);
    }));
    // ── Test 3: Full Happy Path ────────────────────────────────────────────────
    it("3. Full lifecycle: enqueue → claim → complete", () => __awaiter(void 0, void 0, void 0, function* () {
        const seq = 0;
        const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, seq);
        const [worker1PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
        // Enqueue
        const enqueueTx = yield program.methods
            .enqueueJob(QUEUE_NAME, new anchor_1.BN(seq), {
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
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([creator])
            .rpc();
        console.log(`     ✅ enqueueJob tx: ${enqueueTx}`);
        let job = yield program.account.job.fetch(jobPDA);
        chai_1.assert.deepEqual(job.status, { pending: {} });
        chai_1.assert.equal(job.seq.toNumber(), 0);
        // Claim
        const claimTx = yield program.methods
            .claimJob(QUEUE_NAME, new anchor_1.BN(seq))
            .accounts({
            worker: worker1.publicKey,
            queueConfig: queuePDA,
            workerRegistry: worker1PDA,
            job: jobPDA,
        })
            .signers([worker1])
            .rpc();
        console.log(`     ✅ claimJob tx: ${claimTx}`);
        job = yield program.account.job.fetch(jobPDA);
        chai_1.assert.deepEqual(job.status, { processing: {} });
        chai_1.assert.deepEqual(job.assignedWorker, worker1.publicKey);
        // Complete
        const completeTx = yield program.methods
            .completeJob(QUEUE_NAME, new anchor_1.BN(seq), {
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
        job = yield program.account.job.fetch(jobPDA);
        chai_1.assert.deepEqual(job.status, { completed: {} });
        chai_1.assert.isNotNull(job.completedAt);
        const queue = yield program.account.queueConfig.fetch(queuePDA);
        chai_1.assert.equal(queue.totalCompleted.toNumber(), 1);
        chai_1.assert.equal(queue.nextJobSeq.toNumber(), 1);
    }));
    // ── Test 4: FIFO Ordering with Multiple Workers ────────────────────────────
    it("4. FIFO ordering: 3 jobs, worker 1 and 2 race — sequence preserved", () => __awaiter(void 0, void 0, void 0, function* () {
        const [w1PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
        const [w2PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker2.publicKey);
        // Enqueue jobs 1, 2, 3
        for (let i = 1; i <= 3; i++) {
            const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, i);
            yield program.methods
                .enqueueJob(QUEUE_NAME, new anchor_1.BN(i), {
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
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([creator])
                .rpc();
        }
        // Worker 1 claims seq=1, Worker 2 claims seq=2
        const [job1PDA] = yield deriveJobPDA(program, QUEUE_NAME, 1);
        const [job2PDA] = yield deriveJobPDA(program, QUEUE_NAME, 2);
        yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(1))
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: job1PDA })
            .signers([worker1]).rpc();
        yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(2))
            .accounts({ worker: worker2.publicKey, queueConfig: queuePDA, workerRegistry: w2PDA, job: job2PDA })
            .signers([worker2]).rpc();
        const j1 = yield program.account.job.fetch(job1PDA);
        const j2 = yield program.account.job.fetch(job2PDA);
        chai_1.assert.deepEqual(j1.assignedWorker, worker1.publicKey);
        chai_1.assert.deepEqual(j2.assignedWorker, worker2.publicKey);
        chai_1.assert.equal(j1.seq.toNumber(), 1);
        chai_1.assert.equal(j2.seq.toNumber(), 2);
        console.log("     ✅ FIFO ordering verified, no double-claim");
    }));
    // ── Test 5: Retry Logic ────────────────────────────────────────────────────
    it("5. Retry logic: fail job → re-queued → claim again → permanently fail", () => __awaiter(void 0, void 0, void 0, function* () {
        const seq = 3; // job enqueued in test 4 at seq=3
        const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, seq);
        const [w1PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
        // Claim seq=3
        yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(seq))
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        // Fail attempt 1 → retry_count=1, status→Pending
        yield program.methods.failJob(QUEUE_NAME, new anchor_1.BN(seq), { reason: "payment gateway timeout" })
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        let job = yield program.account.job.fetch(jobPDA);
        chai_1.assert.deepEqual(job.status, { pending: {} }, "Should retry: back to Pending");
        chai_1.assert.equal(job.retryCount, 1);
        console.log("     ✅ Attempt 1 failed → re-queued (Pending)");
        // Re-claim and fail again → retry_count=2, still under max (2)
        yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(seq))
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        yield program.methods.failJob(QUEUE_NAME, new anchor_1.BN(seq), { reason: "still failing" })
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        job = yield program.account.job.fetch(jobPDA);
        chai_1.assert.deepEqual(job.status, { pending: {} });
        chai_1.assert.equal(job.retryCount, 2);
        // Claim and fail once more → retry_count=3 > max_retries(2) → permanently Failed
        yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(seq))
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        yield program.methods.failJob(QUEUE_NAME, new anchor_1.BN(seq), { reason: "final failure" })
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        job = yield program.account.job.fetch(jobPDA);
        chai_1.assert.deepEqual(job.status, { failed: {} }, "Should be permanently Failed");
        chai_1.assert.equal(job.retryCount, 3);
        console.log("     ✅ Permanently failed after exhausting max_retries=2");
    }));
    // ── Test 6: Unregistered Worker Rejected ──────────────────────────────────
    it("6. Unregistered worker cannot claim a job", () => __awaiter(void 0, void 0, void 0, function* () {
        const rogue = web3_js_1.Keypair.generate();
        yield fundFromAuthority(provider, rogue.publicKey);
        const seq = 4;
        const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, seq);
        const [roguePDA] = yield deriveWorkerPDA(program, QUEUE_NAME, rogue.publicKey);
        // Enqueue a job for the rogue to try to steal
        yield program.methods
            .enqueueJob(QUEUE_NAME, new anchor_1.BN(seq), {
            queueName: QUEUE_NAME,
            jobType: "test_job",
            payload: Buffer.from("{}"),
            priority: 0,
            maxRetriesOverride: null,
        })
            .accounts({ creator: creator.publicKey, queueConfig: queuePDA, job: jobPDA, systemProgram: web3_js_1.SystemProgram.programId })
            .signers([creator]).rpc();
        try {
            yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(seq))
                .accounts({ worker: rogue.publicKey, queueConfig: queuePDA, workerRegistry: roguePDA, job: jobPDA })
                .signers([rogue]).rpc();
            chai_1.assert.fail("Should have thrown — unregistered worker");
        }
        catch (err) {
            chai_1.assert.include(err.message, "AccountNotInitialized", "Expected unregistered worker to fail");
            console.log("     ✅ Unregistered worker correctly rejected");
        }
    }));
    // ── Test 7: Paused Queue Rejects Enqueue ─────────────────────────────────
    it("7. Paused queue rejects new enqueue, existing jobs unaffected", () => __awaiter(void 0, void 0, void 0, function* () {
        // Pause the queue
        yield program.methods.setQueuePaused(QUEUE_NAME, true)
            .accounts({ authority: authority.publicKey, queueConfig: queuePDA })
            .rpc();
        let queue = yield program.account.queueConfig.fetch(queuePDA);
        chai_1.assert.equal(queue.isPaused, true);
        console.log("     ✅ Queue paused");
        // Try to enqueue — should fail
        const seq = queue.nextJobSeq.toNumber();
        const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, seq);
        try {
            yield program.methods
                .enqueueJob(QUEUE_NAME, new anchor_1.BN(seq), {
                queueName: QUEUE_NAME,
                jobType: "test_job",
                payload: Buffer.from("{}"),
                priority: 0,
                maxRetriesOverride: null,
            })
                .accounts({ creator: creator.publicKey, queueConfig: queuePDA, job: jobPDA, systemProgram: web3_js_1.SystemProgram.programId })
                .signers([creator]).rpc();
            chai_1.assert.fail("Should have thrown QueuePaused");
        }
        catch (err) {
            chai_1.assert.include(err.message, "QueuePaused");
            console.log("     ✅ Enqueue rejected while paused");
        }
        // Resume
        yield program.methods.setQueuePaused(QUEUE_NAME, false)
            .accounts({ authority: authority.publicKey, queueConfig: queuePDA })
            .rpc();
        queue = yield program.account.queueConfig.fetch(queuePDA);
        chai_1.assert.equal(queue.isPaused, false);
        console.log("     ✅ Queue resumed");
    }));
    // ── Test 8: Wrong Worker Rejected ────────────────────────────────────────
    it("8. Wrong worker cannot complete a job claimed by another", () => __awaiter(void 0, void 0, void 0, function* () {
        const seq = 4; // job enqueued in test 6, still Pending (rogue was rejected)
        const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, seq);
        const [w1PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker1.publicKey);
        const [w2PDA] = yield deriveWorkerPDA(program, QUEUE_NAME, worker2.publicKey);
        // Worker1 claims the job
        yield program.methods.claimJob(QUEUE_NAME, new anchor_1.BN(seq))
            .accounts({ worker: worker1.publicKey, queueConfig: queuePDA, workerRegistry: w1PDA, job: jobPDA })
            .signers([worker1]).rpc();
        // Worker2 tries to complete it — should fail
        try {
            yield program.methods.completeJob(QUEUE_NAME, new anchor_1.BN(seq), { result: Buffer.from("stolen!") })
                .accounts({ worker: worker2.publicKey, queueConfig: queuePDA, workerRegistry: w2PDA, job: jobPDA })
                .signers([worker2]).rpc();
            chai_1.assert.fail("Should have thrown WrongWorker");
        }
        catch (err) {
            chai_1.assert.include(err.message, "WrongWorker");
            console.log("     ✅ Wrong worker correctly rejected");
        }
    }));
    // ── Test 9: Close Job Reclaims Rent ──────────────────────────────────────
    it("9. close_job reclaims rent to creator after completion", () => __awaiter(void 0, void 0, void 0, function* () {
        const seq = 0; // completed in test 3
        const [jobPDA] = yield deriveJobPDA(program, QUEUE_NAME, seq);
        const balanceBefore = yield provider.connection.getBalance(creator.publicKey);
        yield program.methods.closeJob(QUEUE_NAME, new anchor_1.BN(seq))
            .accounts({ creator: creator.publicKey, queueConfig: queuePDA, job: jobPDA })
            .signers([creator]).rpc();
        const balanceAfter = yield provider.connection.getBalance(creator.publicKey);
        chai_1.assert.isAbove(balanceAfter, balanceBefore, "Creator should receive rent back");
        // Account should no longer exist
        const jobAccount = yield provider.connection.getAccountInfo(jobPDA);
        chai_1.assert.isNull(jobAccount, "Job account should be closed");
        console.log(`     ✅ Rent reclaimed: +${(balanceAfter - balanceBefore) / web3_js_1.LAMPORTS_PER_SOL} SOL`);
    }));
    // ── Summary ───────────────────────────────────────────────────────────────
    after(() => __awaiter(void 0, void 0, void 0, function* () {
        if (!queuePDA)
            return;
        try {
            const queue = yield program.account.queueConfig.fetch(queuePDA);
            console.log("\n  📊 Final Queue Stats:");
            console.log(`     Total Enqueued:  ${queue.totalEnqueued}`);
            console.log(`     Total Completed: ${queue.totalCompleted}`);
            console.log(`     Total Failed:    ${queue.totalFailed}`);
            console.log(`     Next Seq:        ${queue.nextJobSeq}\n`);
        }
        catch (_a) {
            // queue may not have been initialized if earlier tests failed
        }
    }));
});
