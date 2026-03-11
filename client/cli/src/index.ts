#!/usr/bin/env node

import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import chalk from "chalk";
import ora from "ora";
import { table } from "table";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("6uV8wfz1hufYYYGobTfvFfxETtmJusawL4vM7HhPzJdP");
const DEVNET_URL = clusterApiUrl("devnet");
const IDL_PATH   = path.join(__dirname, "../../target/idl/solqueue.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadWallet(keypairPath?: string): Keypair {
  const kpPath = keypairPath ?? path.join(os.homedir(), ".config/solana/id.json");
  try {
    const raw = fs.readFileSync(kpPath, "utf-8");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    console.error(chalk.red(`❌ Could not load keypair from ${kpPath}`));
    console.error(chalk.yellow("   Run: solana-keygen new -o ~/.config/solana/id.json"));
    process.exit(1);
  }
}

function setupProvider(keypair: Keypair) {
  const connection = new Connection(DEVNET_URL, "confirmed");
  const wallet = new anchor.Wallet(keypair);
  return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

function loadProgram(provider: anchor.AnchorProvider) {
  if (!fs.existsSync(IDL_PATH)) {
    console.error(chalk.red(`❌ IDL not found at ${IDL_PATH}`));
    console.error(chalk.yellow("   Run: anchor build"));
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  return new anchor.Program(idl, provider);
}

async function deriveQueuePDA(programId: PublicKey, queueName: string): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), Buffer.from(queueName)],
    programId
  );
}

async function deriveJobPDA(programId: PublicKey, queueName: string, seq: number): Promise<[PublicKey, number]> {
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64LE(BigInt(seq));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), Buffer.from(queueName), seqBuf],
    programId
  );
}

async function deriveWorkerPDA(programId: PublicKey, queueName: string, workerPubkey: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("worker"), Buffer.from(queueName), workerPubkey.toBuffer()],
    programId
  );
}

function explorerLink(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function statusColor(status: any): string {
  if (status.pending)    return chalk.yellow("⏳ Pending");
  if (status.processing) return chalk.blue("⚡ Processing");
  if (status.completed)  return chalk.green("✅ Completed");
  if (status.failed)     return chalk.red("❌ Failed");
  return chalk.gray("Unknown");
}

function formatTimestamp(ts: BN | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts.toNumber() * 1000).toLocaleString();
}

function printSuccess(label: string, sig: string) {
  console.log(chalk.green(`\n✅ ${label}`));
  console.log(chalk.gray(`   Tx: ${sig}`));
  console.log(chalk.cyan(`   🔍 ${explorerLink(sig)}\n`));
}

// ─── CLI Definition ───────────────────────────────────────────────────────────

const program = new Command();

program
  .name("solqueue")
  .description(chalk.cyan("⚙️  SolQueue — On-Chain Job Queue CLI"))
  .version("1.0.0")
  .option("-k, --keypair <path>", "Path to Solana keypair JSON");

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command("init <queueName>")
  .description("Initialize a new queue on Devnet")
  .option("-r, --max-retries <n>", "Max retries per job", "3")
  .option("-t, --timeout <secs>", "Job timeout in seconds", "300")
  .action(async (queueName, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const [queuePDA] = await deriveQueuePDA(PROGRAM_ID, queueName);

    const spinner = ora(`Initializing queue '${queueName}'...`).start();
    try {
      const tx = await prog.methods
        .initializeQueue({
          queueName,
          maxRetries: parseInt(opts.maxRetries),
          jobTimeoutSecs: new BN(parseInt(opts.timeout)),
        })
        .accounts({
          authority: keypair.publicKey,
          queueConfig: queuePDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      spinner.stop();
      printSuccess(`Queue '${queueName}' initialized`, tx);
      console.log(chalk.white(`   Queue PDA: ${queuePDA.toBase58()}`));
      console.log(chalk.gray(`   Max Retries: ${opts.maxRetries}  |  Timeout: ${opts.timeout}s\n`));
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

// ── worker register ──────────────────────────────────────────────────────────

program
  .command("worker-register <queueName> [workerPubkey]")
  .description("Register a worker for a queue (authority only)")
  .action(async (queueName, workerPubkeyStr, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);

    const workerKey = workerPubkeyStr
      ? new PublicKey(workerPubkeyStr)
      : keypair.publicKey;

    const [queuePDA]  = await deriveQueuePDA(PROGRAM_ID, queueName);
    const [workerPDA] = await deriveWorkerPDA(PROGRAM_ID, queueName, workerKey);

    const spinner = ora(`Registering worker ${workerKey.toBase58().slice(0,8)}...`).start();
    try {
      const tx = await prog.methods
        .registerWorker(queueName)
        .accounts({
          authority: keypair.publicKey,
          queueConfig: queuePDA,
          worker: workerKey,
          workerRegistry: workerPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      spinner.stop();
      printSuccess("Worker registered", tx);
      console.log(chalk.white(`   Worker: ${workerKey.toBase58()}\n`));
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

// ── enqueue ───────────────────────────────────────────────────────────────────

program
  .command("enqueue <queueName> <jobType> <payload>")
  .description("Add a job to the queue")
  .option("-p, --priority <n>", "Priority 0-255", "0")
  .action(async (queueName, jobType, payload, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);

    const [queuePDA] = await deriveQueuePDA(PROGRAM_ID, queueName);
    const queueAccount = await prog.account.queueConfig.fetch(queuePDA);
    const seq = queueAccount.nextJobSeq.toNumber();
    const [jobPDA] = await deriveJobPDA(PROGRAM_ID, queueName, seq);

    const spinner = ora(`Enqueueing ${jobType} job (seq=${seq})...`).start();
    try {
      const tx = await prog.methods
        .enqueueJob(queueName, new BN(seq), {
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      spinner.stop();
      printSuccess(`Job #${seq} enqueued`, tx);
      console.log(chalk.white(`   Job PDA: ${jobPDA.toBase58()}`));
      console.log(chalk.gray(`   Type: ${jobType}  |  Priority: ${opts.priority}  |  Seq: ${seq}\n`));
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

// ── claim ─────────────────────────────────────────────────────────────────────

program
  .command("claim <queueName> <seq>")
  .description("Worker claims a Pending job by sequence number")
  .action(async (queueName, seqStr, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);

    const [queuePDA]  = await deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA]    = await deriveJobPDA(PROGRAM_ID, queueName, seq);
    const [workerPDA] = await deriveWorkerPDA(PROGRAM_ID, queueName, keypair.publicKey);

    const spinner = ora(`Claiming job #${seq}...`).start();
    try {
      const tx = await prog.methods
        .claimJob(queueName, new BN(seq))
        .accounts({
          worker: keypair.publicKey,
          queueConfig: queuePDA,
          workerRegistry: workerPDA,
          job: jobPDA,
        })
        .rpc();
      spinner.stop();
      printSuccess(`Job #${seq} claimed`, tx);
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

// ── complete ──────────────────────────────────────────────────────────────────

program
  .command("complete <queueName> <seq> <result>")
  .description("Mark a Processing job as Completed")
  .action(async (queueName, seqStr, result, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);

    const [queuePDA]  = await deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA]    = await deriveJobPDA(PROGRAM_ID, queueName, seq);
    const [workerPDA] = await deriveWorkerPDA(PROGRAM_ID, queueName, keypair.publicKey);

    const spinner = ora(`Completing job #${seq}...`).start();
    try {
      const tx = await prog.methods
        .completeJob(queueName, new BN(seq), {
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
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

// ── fail ──────────────────────────────────────────────────────────────────────

program
  .command("fail <queueName> <seq> <reason>")
  .description("Mark a Processing job as Failed (retries if applicable)")
  .action(async (queueName, seqStr, reason, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);

    const [queuePDA]  = await deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA]    = await deriveJobPDA(PROGRAM_ID, queueName, seq);
    const [workerPDA] = await deriveWorkerPDA(PROGRAM_ID, queueName, keypair.publicKey);

    const spinner = ora(`Failing job #${seq}...`).start();
    try {
      const tx = await prog.methods
        .failJob(queueName, new BN(seq), { reason })
        .accounts({
          worker: keypair.publicKey,
          queueConfig: queuePDA,
          workerRegistry: workerPDA,
          job: jobPDA,
        })
        .rpc();
      spinner.stop();
      printSuccess(`Job #${seq} failed/retried`, tx);
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

// ── status ────────────────────────────────────────────────────────────────────

program
  .command("status <queueName> <seq>")
  .description("Fetch and display current job state")
  .action(async (queueName, seqStr, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);
    const seq = parseInt(seqStr);

    const [queuePDA] = await deriveQueuePDA(PROGRAM_ID, queueName);
    const [jobPDA]   = await deriveJobPDA(PROGRAM_ID, queueName, seq);

    try {
      const job = await prog.account.job.fetch(jobPDA);
      console.log(chalk.cyan(`\n⚙️  Job #${seq} on queue '${queueName}'\n`));
      console.log(`  Status:    ${statusColor(job.status)}`);
      console.log(`  Type:      ${chalk.white(Buffer.from(job.jobType).toString("utf-8").replace(/\0/g, ""))}`);
      console.log(`  Priority:  ${job.priority}`);
      console.log(`  Retries:   ${job.retryCount}/${job.maxRetries}`);
      console.log(`  Creator:   ${job.creator.toBase58()}`);
      console.log(`  Worker:    ${job.assignedWorker?.toBase58() ?? "-"}`);
      console.log(`  Enqueued:  ${formatTimestamp(job.enqueuedAt)}`);
      console.log(`  Started:   ${formatTimestamp(job.startedAt)}`);
      console.log(`  Completed: ${formatTimestamp(job.completedAt)}`);
      const resultStr = Buffer.from(job.result).slice(0, job.resultLen).toString("utf-8");
      if (resultStr) console.log(`  Result:    ${chalk.gray(resultStr)}`);
      console.log(`  PDA:       ${chalk.gray(jobPDA.toBase58())}`);
      console.log(`  🔍 ${chalk.cyan(`https://explorer.solana.com/address/${jobPDA.toBase58()}?cluster=devnet`)}\n`);
    } catch (e: any) {
      console.error(chalk.red(`❌ Job not found: ${e.message}`));
    }
  });

// ── dashboard ────────────────────────────────────────────────────────────────

program
  .command("dashboard <queueName>")
  .description("Print queue stats and recent jobs")
  .option("-n, --limit <n>", "Number of recent jobs to show", "10")
  .action(async (queueName, opts, cmd) => {
    const keypair = loadWallet(cmd.parent.opts().keypair);
    const provider = setupProvider(keypair);
    const prog = loadProgram(provider);

    const [queuePDA] = await deriveQueuePDA(PROGRAM_ID, queueName);

    const spinner = ora("Fetching queue data...").start();
    try {
      const queue = await prog.account.queueConfig.fetch(queuePDA);
      spinner.stop();

      console.log(chalk.cyan(`\n⚙️  SolQueue Dashboard — '${queueName}'\n`));
      console.log(`  Authority:  ${queue.authority.toBase58()}`);
      console.log(`  Status:     ${queue.isPaused ? chalk.red("⏸  PAUSED") : chalk.green("▶  RUNNING")}`);
      console.log(`  Max Retries: ${queue.maxRetries}   Timeout: ${queue.jobTimeoutSecs}s`);
      console.log(`  Next Seq:   ${queue.nextJobSeq}`);
      console.log();

      const statsData = [
        [chalk.bold("Enqueued"), chalk.bold("Completed"), chalk.bold("Failed"), chalk.bold("Pending")],
        [
          chalk.white(queue.totalEnqueued.toString()),
          chalk.green(queue.totalCompleted.toString()),
          chalk.red(queue.totalFailed.toString()),
          chalk.yellow((queue.totalEnqueued.toNumber() - queue.totalCompleted.toNumber() - queue.totalFailed.toNumber()).toString()),
        ],
      ];
      console.log(table(statsData));

      // Fetch recent jobs
      const limit = Math.min(parseInt(opts.limit), queue.nextJobSeq.toNumber());
      const startSeq = Math.max(0, queue.nextJobSeq.toNumber() - limit);

      const jobs: any[] = [];
      for (let seq = startSeq; seq < queue.nextJobSeq.toNumber(); seq++) {
        try {
          const [jobPDA] = await deriveJobPDA(PROGRAM_ID, queueName, seq);
          const job = await prog.account.job.fetch(jobPDA);
          jobs.push({ seq, job });
        } catch {
          // Job might be closed (rent reclaimed)
        }
      }

      if (jobs.length > 0) {
        console.log(chalk.bold("  Recent Jobs:\n"));
        const jobTableData = [
          ["Seq", "Type", "Status", "Priority", "Retries", "Worker"].map(h => chalk.bold(h)),
          ...jobs.map(({ seq, job }) => [
            seq.toString(),
            Buffer.from(job.jobType).toString("utf-8").replace(/\0/g, "").slice(0, 20),
            statusColor(job.status),
            job.priority.toString(),
            `${job.retryCount}/${job.maxRetries}`,
            job.assignedWorker?.toBase58().slice(0, 8) + "..." ?? "-",
          ]),
        ];
        console.log(table(jobTableData));
      }
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(`❌ ${e.message}`));
    }
  });

program.parse(process.argv);
