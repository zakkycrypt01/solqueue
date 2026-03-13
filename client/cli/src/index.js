#!/usr/bin/env node
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const table_1 = require("table");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
// ─── Config ──────────────────────────────────────────────────────────────────
const PROGRAM_ID = new web3_js_1.PublicKey("EuzHoVFafwymNComWL1K1ehEt4V6d1CpGx5mUqsQP8r4");
const DEVNET_URL = (0, web3_js_1.clusterApiUrl)("devnet");
const IDL_PATH = path.join(__dirname, "../../target/idl/solqueue.json");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadWallet(keypairPath) {
    const kpPath = keypairPath !== null && keypairPath !== void 0 ? keypairPath : path.join(os.homedir(), ".config/solana/id.json");
    try {
        const raw = fs.readFileSync(kpPath, "utf-8");
        return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    catch (_a) {
        console.error(chalk_1.default.red(`❌ Could not load keypair from ${kpPath}`));
        console.error(chalk_1.default.yellow("   Run: solana-keygen new -o ~/.config/solana/id.json"));
        process.exit(1);
    }
}
function setupProvider(keypair) {
    const connection = new web3_js_1.Connection(DEVNET_URL, "confirmed");
    const wallet = new anchor.Wallet(keypair);
    return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}
function loadProgram(provider) {
    if (!fs.existsSync(IDL_PATH)) {
        console.error(chalk_1.default.red(`❌ IDL not found at ${IDL_PATH}`));
        console.error(chalk_1.default.yellow("   Run: anchor build"));
        process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
    return new anchor.Program(idl, provider);
}
function deriveQueuePDA(programId, queueName) {
    return __awaiter(this, void 0, void 0, function* () {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("queue"), Buffer.from(queueName)], programId);
    });
}
function deriveJobPDA(programId, queueName, seq) {
    return __awaiter(this, void 0, void 0, function* () {
        const seqBuf = Buffer.alloc(8);
        seqBuf.writeBigUInt64LE(BigInt(seq));
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("job"), Buffer.from(queueName), seqBuf], programId);
    });
}
function deriveWorkerPDA(programId, queueName, workerPubkey) {
    return __awaiter(this, void 0, void 0, function* () {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("worker"), Buffer.from(queueName), workerPubkey.toBuffer()], programId);
    });
}
function explorerLink(sig) {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function statusColor(status) {
    if (status.pending)
        return chalk_1.default.yellow("⏳ Pending");
    if (status.processing)
        return chalk_1.default.blue("⚡ Processing");
    if (status.completed)
        return chalk_1.default.green("✅ Completed");
    if (status.failed)
        return chalk_1.default.red("❌ Failed");
    return chalk_1.default.gray("Unknown");
}
function formatTimestamp(ts) {
    if (!ts)
        return "-";
    return new Date(ts.toNumber() * 1000).toLocaleString();
}
function printSuccess(label, sig) {
    console.log(chalk_1.default.green(`\n✅ ${label}`));
    console.log(chalk_1.default.gray(`   Tx: ${sig}`));
    console.log(chalk_1.default.cyan(`   🔍 ${explorerLink(sig)}\n`));
}
// ─── CLI Definition ───────────────────────────────────────────────────────────
const program = new commander_1.Command();
program
    .name("solqueue")
    .description(chalk_1.default.cyan("⚙️  SolQueue — On-Chain Job Queue CLI"))
    .version("1.0.0")
    .option("-k, --keypair <path>", "Path to Solana keypair JSON");
// ── init ─────────────────────────────────────────────────────────────────────
program
    .command("init <queueName>")
    .description("Initialize a new queue on Devnet")
    .option("-r, --max-retries <n>", "Max retries per job", "3")
    .option("-t, --timeout <secs>", "Job timeout in seconds", "300")
    .action((queueName, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const spinner = (0, ora_1.default)(`Initializing queue '${queueName}'...`).start();
    try {
        const tx = yield prog.methods
            .initializeQueue({
            queueName,
            maxRetries: parseInt(opts.maxRetries),
            jobTimeoutSecs: new anchor_1.BN(parseInt(opts.timeout)),
        })
            .accounts({
            authority: keypair.publicKey,
            queueConfig: queuePDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        spinner.stop();
        printSuccess(`Queue '${queueName}' initialized`, tx);
        console.log(chalk_1.default.white(`   Queue PDA: ${queuePDA.toBase58()}`));
        console.log(chalk_1.default.gray(`   Max Retries: ${opts.maxRetries}  |  Timeout: ${opts.timeout}s\n`));
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
// ── worker register ──────────────────────────────────────────────────────────
program
    .command("worker-register <queueName> [workerPubkey]")
    .description("Register a worker for a queue (authority only)")
    .action((queueName, workerPubkeyStr, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const workerKey = workerPubkeyStr
        ? new web3_js_1.PublicKey(workerPubkeyStr)
        : keypair.publicKey;
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const [workerPDA] = yield deriveWorkerPDA(PROGRAM_ID, queueName, workerKey);
    const spinner = (0, ora_1.default)(`Registering worker ${workerKey.toBase58().slice(0, 8)}...`).start();
    try {
        const tx = yield prog.methods
            .registerWorker(queueName)
            .accounts({
            authority: keypair.publicKey,
            queueConfig: queuePDA,
            worker: workerKey,
            workerRegistry: workerPDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        spinner.stop();
        printSuccess("Worker registered", tx);
        console.log(chalk_1.default.white(`   Worker: ${workerKey.toBase58()}\n`));
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
// ── enqueue ───────────────────────────────────────────────────────────────────
program
    .command("enqueue <queueName> <jobType> <payload>")
    .description("Add a job to the queue")
    .option("-p, --priority <n>", "Priority 0-255", "0")
    .action((queueName, jobType, payload, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const queueAccount = yield prog.account.queueConfig.fetch(queuePDA);
    const seq = queueAccount.nextJobSeq.toNumber();
    const [jobPDA] = yield deriveJobPDA(PROGRAM_ID, queueName, seq);
    const spinner = (0, ora_1.default)(`Enqueueing ${jobType} job (seq=${seq})...`).start();
    try {
        const tx = yield prog.methods
            .enqueueJob(queueName, new anchor_1.BN(seq), {
            queueName,
            jobType,
            payload: Buffer.from(payload, "utf-8"),
            priority: parseInt(opts.priority),
            maxRetriesOverride: null,
        })
            .accounts({
            creator: keypair.publicKey,
            queueConfig: queuePDA,
            job: jobPDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        spinner.stop();
        printSuccess(`Job #${seq} enqueued`, tx);
        console.log(chalk_1.default.white(`   Job PDA: ${jobPDA.toBase58()}`));
        console.log(chalk_1.default.gray(`   Type: ${jobType}  |  Priority: ${opts.priority}  |  Seq: ${seq}\n`));
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
// ── claim ─────────────────────────────────────────────────────────────────────
program
    .command("claim <queueName> <seq>")
    .description("Worker claims a Pending job by sequence number")
    .action((queueName, seqStr, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA] = yield deriveJobPDA(PROGRAM_ID, queueName, seq);
    const [workerPDA] = yield deriveWorkerPDA(PROGRAM_ID, queueName, keypair.publicKey);
    const spinner = (0, ora_1.default)(`Claiming job #${seq}...`).start();
    try {
        const tx = yield prog.methods
            .claimJob(queueName, new anchor_1.BN(seq))
            .accounts({
            worker: keypair.publicKey,
            queueConfig: queuePDA,
            workerRegistry: workerPDA,
            job: jobPDA,
        })
            .rpc();
        spinner.stop();
        printSuccess(`Job #${seq} claimed`, tx);
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
// ── complete ──────────────────────────────────────────────────────────────────
program
    .command("complete <queueName> <seq> <result>")
    .description("Mark a Processing job as Completed")
    .action((queueName, seqStr, result, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA] = yield deriveJobPDA(PROGRAM_ID, queueName, seq);
    const [workerPDA] = yield deriveWorkerPDA(PROGRAM_ID, queueName, keypair.publicKey);
    const spinner = (0, ora_1.default)(`Completing job #${seq}...`).start();
    try {
        const tx = yield prog.methods
            .completeJob(queueName, new anchor_1.BN(seq), {
            result: Buffer.from(result, "utf-8"),
        })
            .accounts({
            worker: keypair.publicKey,
            queueConfig: queuePDA,
            workerRegistry: workerPDA,
            job: jobPDA,
        })
            .rpc();
        spinner.stop();
        printSuccess(`Job #${seq} completed`, tx);
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
// ── fail ──────────────────────────────────────────────────────────────────────
program
    .command("fail <queueName> <seq> <reason>")
    .description("Mark a Processing job as Failed (retries if applicable)")
    .action((queueName, seqStr, reason, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA] = yield deriveJobPDA(PROGRAM_ID, queueName, seq);
    const [workerPDA] = yield deriveWorkerPDA(PROGRAM_ID, queueName, keypair.publicKey);
    const spinner = (0, ora_1.default)(`Failing job #${seq}...`).start();
    try {
        const tx = yield prog.methods
            .failJob(queueName, new anchor_1.BN(seq), { reason })
            .accounts({
            worker: keypair.publicKey,
            queueConfig: queuePDA,
            workerRegistry: workerPDA,
            job: jobPDA,
        })
            .rpc();
        spinner.stop();
        printSuccess(`Job #${seq} failed/retried`, tx);
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
// ── status ────────────────────────────────────────────────────────────────────
program
    .command("status <queueName> <seq>")
    .description("Fetch and display current job state")
    .action((queueName, seqStr, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA] = yield deriveJobPDA(PROGRAM_ID, queueName, seq);
    try {
        const job = yield prog.account.job.fetch(jobPDA);
        console.log(chalk_1.default.cyan(`\n⚙️  Job #${seq} on queue '${queueName}'\n`));
        console.log(`  Status:    ${statusColor(job.status)}`);
        console.log(`  Type:      ${chalk_1.default.white(Buffer.from(job.jobType).toString("utf-8").replace(/\0/g, ""))}`);
        console.log(`  Priority:  ${job.priority}`);
        console.log(`  Retries:   ${job.retryCount}/${job.maxRetries}`);
        console.log(`  Creator:   ${job.creator.toBase58()}`);
        console.log(`  Worker:    ${(_b = (_a = job.assignedWorker) === null || _a === void 0 ? void 0 : _a.toBase58()) !== null && _b !== void 0 ? _b : "-"}`);
        console.log(`  Enqueued:  ${formatTimestamp(job.enqueuedAt)}`);
        console.log(`  Started:   ${formatTimestamp(job.startedAt)}`);
        console.log(`  Completed: ${formatTimestamp(job.completedAt)}`);
        const resultStr = Buffer.from(job.result).slice(0, job.resultLen).toString("utf-8");
        if (resultStr)
            console.log(`  Result:    ${chalk_1.default.gray(resultStr)}`);
        console.log(`  PDA:       ${chalk_1.default.gray(jobPDA.toBase58())}`);
        console.log(`  🔍 ${chalk_1.default.cyan(`https://explorer.solana.com/address/${jobPDA.toBase58()}?cluster=devnet`)}\n`);
    }
    catch (e) {
        console.error(chalk_1.default.red(`❌ Job not found: ${e.message}`));
    }
}));
// ── dashboard ────────────────────────────────────────────────────────────────
program
    .command("dashboard <queueName>")
    .description("Print queue stats and recent jobs")
    .option("-n, --limit <n>", "Number of recent jobs to show", "10")
    .action((queueName, opts, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const [queuePDA] = yield deriveQueuePDA(PROGRAM_ID, queueName);
    const spinner = (0, ora_1.default)("Fetching queue data...").start();
    try {
        const queue = yield prog.account.queueConfig.fetch(queuePDA);
        spinner.stop();
        console.log(chalk_1.default.cyan(`\n⚙️  SolQueue Dashboard — '${queueName}'\n`));
        console.log(`  Authority:  ${queue.authority.toBase58()}`);
        console.log(`  Status:     ${queue.isPaused ? chalk_1.default.red("⏸  PAUSED") : chalk_1.default.green("▶  RUNNING")}`);
        console.log(`  Max Retries: ${queue.maxRetries}   Timeout: ${queue.jobTimeoutSecs}s`);
        console.log(`  Next Seq:   ${queue.nextJobSeq}`);
        console.log();
        const statsData = [
            [chalk_1.default.bold("Enqueued"), chalk_1.default.bold("Completed"), chalk_1.default.bold("Failed"), chalk_1.default.bold("Pending")],
            [
                chalk_1.default.white(queue.totalEnqueued.toString()),
                chalk_1.default.green(queue.totalCompleted.toString()),
                chalk_1.default.red(queue.totalFailed.toString()),
                chalk_1.default.yellow((queue.totalEnqueued.toNumber() - queue.totalCompleted.toNumber() - queue.totalFailed.toNumber()).toString()),
            ],
        ];
        console.log((0, table_1.table)(statsData));
        // Fetch recent jobs
        const limit = Math.min(parseInt(opts.limit), queue.nextJobSeq.toNumber());
        const startSeq = Math.max(0, queue.nextJobSeq.toNumber() - limit);
        const jobs = [];
        for (let seq = startSeq; seq < queue.nextJobSeq.toNumber(); seq++) {
            try {
                const [jobPDA] = yield deriveJobPDA(PROGRAM_ID, queueName, seq);
                const job = yield prog.account.job.fetch(jobPDA);
                jobs.push({ seq, job });
            }
            catch (_a) {
                // Job might be closed (rent reclaimed)
            }
        }
        if (jobs.length > 0) {
            console.log(chalk_1.default.bold("  Recent Jobs:\n"));
            const jobTableData = [
                ["Seq", "Type", "Status", "Priority", "Retries", "Worker"].map(h => chalk_1.default.bold(h)),
                ...jobs.map(({ seq, job }) => {
                    var _a, _b;
                    return [
                        seq.toString(),
                        Buffer.from(job.jobType).toString("utf-8").replace(/\0/g, "").slice(0, 20),
                        statusColor(job.status),
                        job.priority.toString(),
                        `${job.retryCount}/${job.maxRetries}`,
                        (_b = ((_a = job.assignedWorker) === null || _a === void 0 ? void 0 : _a.toBase58().slice(0, 8)) + "...") !== null && _b !== void 0 ? _b : "-",
                    ];
                }),
            ];
            console.log((0, table_1.table)(jobTableData));
        }
    }
    catch (e) {
        spinner.stop();
        console.error(chalk_1.default.red(`❌ ${e.message}`));
    }
}));
program.parse(process.argv);
