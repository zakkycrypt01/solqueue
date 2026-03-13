import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, clusterApiUrl, Transaction, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  Activity, Zap, CheckCircle, XCircle, Clock, RefreshCw,
  Send, Users, BarChart3, AlertCircle, PauseCircle, PlayCircle
} from "lucide-react";

// @ts-ignore - IDL type from @coral-xyz/anchor doesn't match exact JSON structure
import IDLJson from "../../../target/idl/solqueue.json";
const IDL = IDLJson as any;

// ─── Constants ────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("EuzHoVFafwymNComWL1K1ehEt4V6d1CpGx5mUqsQP8r4");
const CONNECTION  = new Connection(clusterApiUrl("devnet"), "confirmed");

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueStats {
  authority: string;
  nextJobSeq: number;
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
  isPaused: boolean;
  maxRetries: number;
  jobTimeoutSecs: number;
}

interface JobItem {
  pubkey: string;
  seq: number;
  jobType: string;
  status: "pending" | "processing" | "completed" | "failed";
  priority: number;
  retryCount: number;
  maxRetries: number;
  assignedWorker: string | null;
  creator: string;
  enqueuedAt: number;
  completedAt: number | null;
  result: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveQueuePDA(queueName: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), Buffer.from(queueName)],
    PROGRAM_ID
  );
  return pda;
}

function deriveJobPDA(queueName: string, seq: number): PublicKey {
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64LE(BigInt(seq));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("job"), Buffer.from(queueName), seqBuf],
    PROGRAM_ID
  );
  return pda;
}

function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function explorerAddr(addr: string) {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

function statusConfig(status: string) {
  switch (status) {
    case "pending":    return { label: "Pending",    color: "bg-yellow-100 text-yellow-800", icon: Clock };
    case "processing": return { label: "Processing", color: "bg-blue-100 text-blue-800",    icon: Zap };
    case "completed":  return { label: "Completed",  color: "bg-green-100 text-green-800",  icon: CheckCircle };
    case "failed":     return { label: "Failed",     color: "bg-red-100 text-red-800",      icon: XCircle };
    default:           return { label: "Unknown",    color: "bg-gray-100 text-gray-800",    icon: AlertCircle };
  }
}

function parseStatus(rawStatus: any): JobItem["status"] {
  if (rawStatus?.pending)    return "pending";
  if (rawStatus?.processing) return "processing";
  if (rawStatus?.completed)  return "completed";
  if (rawStatus?.failed)     return "failed";
  return "pending";
}

function trimNull(arr: number[] | Uint8Array): string {
  const buf = Buffer.from(arr);
  const end = buf.indexOf(0);
  return buf.slice(0, end === -1 ? buf.length : end).toString("utf-8");
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: any; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function JobRow({ 
  job, 
  wallet,
  onClaim,
  onComplete,
  onFail,
}: { 
  job: JobItem;
  wallet: any;
  onClaim: (seq: number) => Promise<void>;
  onComplete: (seq: number) => Promise<void>;
  onFail: (seq: number) => Promise<void>;
}) {
  const { label, color, icon: StatusIcon } = statusConfig(job.status);
  const canClaim = job.status === "pending" && wallet.connected;
  const canComplete = job.status === "processing" && wallet.connected && job.assignedWorker === wallet.publicKey?.toBase58();
  const canFail = job.status === "processing" && wallet.connected && job.assignedWorker === wallet.publicKey?.toBase58();

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4 font-mono text-sm text-gray-700">#{job.seq}</td>
      <td className="py-3 px-4 text-sm font-medium text-gray-900">{job.jobType}</td>
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
          <StatusIcon size={12} />
          {label}
        </span>
      </td>
      <td className="py-3 px-4 text-sm text-gray-600">{job.priority}</td>
      <td className="py-3 px-4 text-sm text-gray-600">{job.retryCount}/{job.maxRetries}</td>
      <td className="py-3 px-4 font-mono text-xs text-gray-500">
        {job.assignedWorker ? (
          <a href={explorerAddr(job.assignedWorker)} target="_blank" rel="noopener noreferrer"
             className="text-purple-600 hover:underline">
            {job.assignedWorker.slice(0, 8)}…
          </a>
        ) : "—"}
      </td>
      <td className="py-3 px-4 text-xs text-gray-500">
        {new Date(job.enqueuedAt * 1000).toLocaleTimeString()}
      </td>
      <td className="py-3 px-4 flex items-center gap-2">
        <a href={explorerAddr(job.pubkey)} target="_blank" rel="noopener noreferrer"
           className="text-purple-600 hover:underline font-mono text-xs">
          {job.pubkey.slice(0, 8)}…
        </a>
        <div className="flex gap-1">
          {canClaim && (
            <button
              onClick={() => onClaim(job.seq)}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
              title="Claim this job for processing"
            >
              Claim
            </button>
          )}
          {canComplete && (
            <button
              onClick={() => onComplete(job.seq)}
              className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
              title="Mark as completed"
            >
              Complete
            </button>
          )}
          {canFail && (
            <button
              onClick={() => onFail(job.seq)}
              className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
              title="Mark as failed (will retry)"
            >
              Fail
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const wallet = useWallet();
  const [queueName, setQueueName]   = useState("my-queue");
  const [inputQueue, setInputQueue] = useState("my-queue");
  const [stats, setStats]           = useState<QueueStats | null>(null);
  const [jobs, setJobs]             = useState<JobItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Enqueue form state
  const [jobType, setJobType]   = useState("send_email");
  const [payload, setPayload]   = useState('{"to":"user@example.com"}');
  const [priority, setPriority] = useState("0");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // ── Fetch queue data ─────────────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    if (!queueName) return;
    setLoading(true);
    setError(null);

    try {
      const queuePDA = deriveQueuePDA(queueName);
      const accountInfo = await CONNECTION.getAccountInfo(queuePDA);
      if (!accountInfo) {
        setError(`Queue '${queueName}' not found on Devnet. Initialize it first.`);
        setStats(null);
        setJobs([]);
        return;
      }

      // Manually parse QueueConfig account structure
      // Structure: authority(32) + queue_name(32) + next_job_seq(8) + total_enqueued(8) + 
      //           total_completed(8) + total_failed(8) + is_paused(1) + max_retries(1) + job_timeout_secs(8) + bump(1)
      const data = accountInfo.data;
      let offset = 8; // Skip discriminator
      
      const authority = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const queue_name_bytes = data.slice(offset, offset + 32);
      offset += 32;
      
      const nextJobSeq = Number(data.readBigUInt64LE(offset));
      offset += 8;
      
      const totalEnqueued = Number(data.readBigUInt64LE(offset));
      offset += 8;
      
      const totalCompleted = Number(data.readBigUInt64LE(offset));
      offset += 8;
      
      const totalFailed = Number(data.readBigUInt64LE(offset));
      offset += 8;
      
      const isPaused = data[offset] === 1;
      offset += 1;
      
      const maxRetries = data[offset];
      offset += 1;
      
      const jobTimeoutSecs = Number(data.readBigInt64LE(offset));
      
      setStats({
        authority: authority.toBase58().slice(0, 8) + "...",
        nextJobSeq,
        totalEnqueued,
        totalCompleted,
        totalFailed,
        isPaused,
        maxRetries,
        jobTimeoutSecs: Number(jobTimeoutSecs),
      });

      setError(null);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError("Error fetching queue: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [queueName]);

  // ── Enqueue Job Handler ──────────────────────────────────────────────────

  // ── Fetch Jobs ──────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    if (!stats) return;

    try {
      const allJobs: JobItem[] = [];
      
      // Fetch jobs from seq 0 to nextJobSeq - 1
      for (let seq = 0; seq < Math.min(stats.nextJobSeq, 50); seq++) {
        try {
          const jobPDA = deriveJobPDA(queueName, seq);
          const accountInfo = await CONNECTION.getAccountInfo(jobPDA);
          
          if (!accountInfo) continue;

          // Parse Job account: queue(32) + seq(8) + status(1) + job_type(32 null-padded) + 
          //                     payload(512) + priority(1) + retry_count(1) + assigned_worker(32) + 
          //                     creator(32) + enqueued_at(8) + completed_at(8) + result(128)
          const data = accountInfo.data;
          let offset = 8; // Skip discriminator

          const queue = new PublicKey(data.slice(offset, offset + 32));
          offset += 32;

          const seqRead = Number(data.readBigUInt64LE(offset));
          offset += 8;

          // Status is a Rust enum, first byte indicates variant (0=pending, 1=processing, 2=completed, 3=failed)
          const statusRaw = data[offset];
          offset += 1;

          let status: JobItem["status"] = "pending";
          if (statusRaw === 1) status = "processing";
          else if (statusRaw === 2) status = "completed";
          else if (statusRaw === 3) status = "failed";

          const jobTypeBytes = data.slice(offset, offset + 32);
          const jobType = trimNull(jobTypeBytes);
          offset += 32;

          const payloadBytes = data.slice(offset, offset + 512);
          offset += 512;

          const priority = data[offset];
          offset += 1;

          const retryCount = data[offset];
          offset += 1;

          const maxRetriesBytes = data.slice(offset, offset + 1);
          const maxRetries = maxRetriesBytes[0];
          offset += 1;

          const assignedWorker = new PublicKey(data.slice(offset, offset + 32));
          offset += 32;

          const creator = new PublicKey(data.slice(offset, offset + 32));
          offset += 32;

          const enqueuedAt = Number(data.readBigUInt64LE(offset));
          offset += 8;

          const completedAt = Number(data.readBigUInt64LE(offset));
          offset += 8;

          const resultBytes = data.slice(offset, Math.min(offset + 128, data.length));

          allJobs.push({
            pubkey: jobPDA.toBase58(),
            seq: seqRead,
            jobType,
            status,
            priority,
            retryCount,
            maxRetries,
            assignedWorker: assignedWorker.toBase58() === "11111111111111111111111111111111" ? null : assignedWorker.toBase58(),
            creator: creator.toBase58(),
            enqueuedAt,
            completedAt: completedAt === 0 ? null : completedAt,
            result: trimNull(resultBytes),
          });
        } catch (e) {
          // Job account doesn't exist yet, skip
        }
      }

      setJobs(allJobs);
    } catch (e: any) {
      console.error("Error fetching jobs:", e);
    }
  }, [stats, queueName]);

  // ── Enqueue Job Handler ──────────────────────────────────────────────────

  const handleEnqueueJob = useCallback(async () => {
    if (!wallet.publicKey) {
      setStatusMsg("❌ Please connect your Solana wallet first");
      return;
    }

    if (!stats) {
      setStatusMsg("❌ Queue stats not loaded");
      return;
    }

    try {
      setStatusMsg("⏳ Preparing transaction...");

      // Parse payload as JSON
      let payloadBytes: Buffer;
      try {
        const payloadObj = JSON.parse(payload);
        payloadBytes = Buffer.from(JSON.stringify(payloadObj));
      } catch (e) {
        setStatusMsg("❌ Invalid JSON payload");
        return;
      }

      if (payloadBytes.length > 512) {
        setStatusMsg("❌ Payload exceeds 512 bytes");
        return;
      }

      // Create program instance with wallet provider
      // @ts-ignore - wallet adapter types not fully compatible with AnchorProvider
      const provider = new anchor.AnchorProvider(CONNECTION, wallet as any, { commitment: "confirmed" });
      // @ts-ignore - IDL type mismatch with AnchorProvider
      const program = new anchor.Program(IDL, PROGRAM_ID, provider);

      const queuePDA = deriveQueuePDA(queueName);
      const seq = stats.nextJobSeq;
      const jobPDA = deriveJobPDA(queueName, seq);

      // Build the enqueue_job transaction
      // @ts-ignore - complex recursion in type inference  
      const tx = await program.methods.enqueueJob(queueName, new BN(seq), {
        queueName,
        jobType,
        payload: Array.from(payloadBytes),
        priority: parseInt(priority),
        maxRetriesOverride: null,
      })
        .accounts({
          creator: wallet.publicKey,
          queueConfig: queuePDA,
          job: jobPDA,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await CONNECTION.getLatestBlockhash()).blockhash;

      if (!wallet.signTransaction) {
        setStatusMsg("❌ Wallet does not support signing transactions");
        return;
      }

      setStatusMsg("⏳ Signing transaction...");
      const signedTx = await wallet.signTransaction(tx);

      setStatusMsg("⏳ Sending transaction...");
      const sig = await CONNECTION.sendRawTransaction(signedTx.serialize());

      setStatusMsg(`⏳ Confirming... ${sig.slice(0, 8)}...`);
      await CONNECTION.confirmTransaction(sig);

      setStatusMsg(`✅ Job enqueued! TX: ${sig.slice(0, 8)}...`);
      
      // Reset form
      setPayload('{"to":"user@example.com"}');
      setJobType("send_email");
      setPriority("0");

      // Refresh queue stats and jobs
      setTimeout(() => {
        fetchQueue();
        fetchJobs();
      }, 2000);
    } catch (e: any) {
      console.error("Enqueue error:", e);
      setStatusMsg(`❌ ${e.message || "Failed to enqueue job"}`);
    }
  }, [wallet, stats, queueName, jobType, payload, priority, fetchQueue, fetchJobs]);

  // ── Claim Job Handler ────────────────────────────────────────────────────

  const handleClaimJob = useCallback(async (seq: number) => {
    if (!wallet.publicKey) {
      setStatusMsg("❌ Please connect your Solana wallet first");
      return;
    }

    try {
      setStatusMsg(`⏳ Claiming job ${seq}...`);

      // @ts-ignore - wallet adapter types not fully compatible with AnchorProvider
      const provider = new anchor.AnchorProvider(CONNECTION, wallet as any, { commitment: "confirmed" });
      // @ts-ignore - IDL type mismatch with AnchorProvider
      const program = new anchor.Program(IDL, PROGRAM_ID, provider);

      const queuePDA = deriveQueuePDA(queueName);
      const jobPDA = deriveJobPDA(queueName, seq);
      const [workerPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("worker"), Buffer.from(queueName), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await program.methods.claimJob(queueName, new BN(seq))
        .accounts({
          worker: wallet.publicKey,
          queueConfig: queuePDA,
          workerRegistry: workerPDA,
          job: jobPDA,
        })
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await CONNECTION.getLatestBlockhash()).blockhash;

      if (!wallet.signTransaction) {
        setStatusMsg("❌ Wallet does not support signing transactions");
        return;
      }

      setStatusMsg("⏳ Signing claim transaction...");
      const signedTx = await wallet.signTransaction(tx);

      setStatusMsg("⏳ Sending transaction...");
      const sig = await CONNECTION.sendRawTransaction(signedTx.serialize());

      await CONNECTION.confirmTransaction(sig);
      setStatusMsg(`✅ Job claimed! TX: ${sig.slice(0, 8)}...`);

      setTimeout(() => fetchJobs(), 2000);
    } catch (e: any) {
      console.error("Claim error:", e);
      setStatusMsg(`❌ ${e.message || "Failed to claim job"}`);
    }
  }, [wallet, queueName, fetchJobs]);

  // ── Complete Job Handler ─────────────────────────────────────────────────

  const handleCompleteJob = useCallback(async (seq: number) => {
    if (!wallet.publicKey) {
      setStatusMsg("❌ Please connect your Solana wallet first");
      return;
    }

    try {
      setStatusMsg(`⏳ Completing job ${seq}...`);

      // @ts-ignore - wallet adapter types not fully compatible with AnchorProvider
      const provider = new anchor.AnchorProvider(CONNECTION, wallet as any, { commitment: "confirmed" });
      // @ts-ignore - IDL type mismatch with AnchorProvider
      const program = new anchor.Program(IDL, PROGRAM_ID, provider);

      const queuePDA = deriveQueuePDA(queueName);
      const jobPDA = deriveJobPDA(queueName, seq);
      const [workerPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("worker"), Buffer.from(queueName), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await program.methods.completeJob(queueName, new BN(seq), {
        result: Buffer.from("Completed via dashboard"),
      })
        .accounts({
          worker: wallet.publicKey,
          queueConfig: queuePDA,
          workerRegistry: workerPDA,
          job: jobPDA,
        })
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await CONNECTION.getLatestBlockhash()).blockhash;

      if (!wallet.signTransaction) {
        setStatusMsg("❌ Wallet does not support signing transactions");
        return;
      }

      setStatusMsg("⏳ Signing complete transaction...");
      const signedTx = await wallet.signTransaction(tx);

      setStatusMsg("⏳ Sending transaction...");
      const sig = await CONNECTION.sendRawTransaction(signedTx.serialize());

      await CONNECTION.confirmTransaction(sig);
      setStatusMsg(`✅ Job completed! TX: ${sig.slice(0, 8)}...`);

      setTimeout(() => fetchJobs(), 2000);
    } catch (e: any) {
      console.error("Complete error:", e);
      setStatusMsg(`❌ ${e.message || "Failed to complete job"}`);
    }
  }, [wallet, queueName, fetchJobs]);

  // ── Fail Job Handler ─────────────────────────────────────────────────────

  const handleFailJob = useCallback(async (seq: number) => {
    if (!wallet.publicKey) {
      setStatusMsg("❌ Please connect your Solana wallet first");
      return;
    }

    try {
      setStatusMsg(`⏳ Failing job ${seq}...`);

      // @ts-ignore - wallet adapter types not fully compatible with AnchorProvider
      const provider = new anchor.AnchorProvider(CONNECTION, wallet as any, { commitment: "confirmed" });
      // @ts-ignore - IDL type mismatch with AnchorProvider
      const program = new anchor.Program(IDL, PROGRAM_ID, provider);

      const queuePDA = deriveQueuePDA(queueName);
      const jobPDA = deriveJobPDA(queueName, seq);
      const [workerPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("worker"), Buffer.from(queueName), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await program.methods.failJob(queueName, new BN(seq), {
        reason: Buffer.from("Failed via dashboard"),
      })
        .accounts({
          worker: wallet.publicKey,
          queueConfig: queuePDA,
          workerRegistry: workerPDA,
          job: jobPDA,
        })
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await CONNECTION.getLatestBlockhash()).blockhash;

      if (!wallet.signTransaction) {
        setStatusMsg("❌ Wallet does not support signing transactions");
        return;
      }

      setStatusMsg("⏳ Signing fail transaction...");
      const signedTx = await wallet.signTransaction(tx);

      setStatusMsg("⏳ Sending transaction...");
      const sig = await CONNECTION.sendRawTransaction(signedTx.serialize());

      await CONNECTION.confirmTransaction(sig);
      setStatusMsg(`✅ Job failed (marked for retry or dead-letter). TX: ${sig.slice(0, 8)}...`);

      setTimeout(() => fetchJobs(), 2000);
    } catch (e: any) {
      console.error("Fail error:", e);
      setStatusMsg(`❌ ${e.message || "Failed to mark job as failed"}`);
    }
  }, [wallet, queueName, fetchJobs]);

  useEffect(() => {
    fetchQueue();
    setTimeout(fetchJobs, 500);
    const interval = setInterval(() => {
      fetchQueue();
      fetchJobs();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchQueue, fetchJobs]);

  // ── Render ────────────────────────────────────────────────────────────────

  const pending   = jobs.filter(j => j.status === "pending").length;
  const processing = jobs.filter(j => j.status === "processing").length;
  const completed = jobs.filter(j => j.status === "completed").length;
  const failed    = jobs.filter(j => j.status === "failed").length;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-600 flex items-center justify-center">
              <Activity size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">SolQueue</h1>
              <p className="text-xs text-gray-500">On-Chain Job Queue · Solana Devnet</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-400">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchQueue}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <WalletMultiButton className="!bg-purple-600 !text-white hover:!bg-purple-700" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Queue Selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Queue Address</h2>
          <div className="flex gap-3">
            <input
              value={inputQueue}
              onChange={e => setInputQueue(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              placeholder="Enter queue name (e.g. my-queue)"
            />
            <button
              onClick={() => setQueueName(inputQueue)}
              className="px-5 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors"
            >
              Load Queue
            </button>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-4 py-3">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {stats && (
          <>
            {/* Stats Grid */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">{queueName}</h2>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                  stats.isPaused ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                }`}>
                  {stats.isPaused ? <PauseCircle size={12} /> : <PlayCircle size={12} />}
                  {stats.isPaused ? "Paused" : "Running"}
                </span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Enqueued" value={stats.totalEnqueued} icon={Send} color="bg-purple-500" />
                <StatCard label="Completed"      value={stats.totalCompleted} icon={CheckCircle} color="bg-green-500" />
                <StatCard label="Failed"         value={stats.totalFailed} icon={XCircle} color="bg-red-500" />
                <StatCard label="Next Seq"       value={stats.nextJobSeq} icon={BarChart3} color="bg-blue-500" />
              </div>
            </div>

            {/* Enqueue Form */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Send size={18} className="text-purple-600" />
                Enqueue Job
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Job Type</label>
                  <input
                    value={jobType}
                    onChange={e => setJobType(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                    placeholder="e.g. send_email"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Payload (JSON)</label>
                  <input
                    value={payload}
                    onChange={e => setPayload(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                    placeholder='{"key":"value"}'
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Priority (0–255)</label>
                  <input
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    type="number"
                    min="0" max="255"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {wallet.connected ? "✅ Wallet connected" : "❌ Connect a Solana wallet (Phantom/Backpack) to sign transactions"}
                </p>
                <button
                  disabled={!wallet.connected}
                  className="px-5 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  onClick={handleEnqueueJob}
                >
                  <Send size={14} />
                  Enqueue Job
                </button>
              </div>
              {statusMsg && (
                <div className="mt-3 text-xs text-purple-700 bg-purple-50 rounded-lg px-4 py-3">
                  {statusMsg}
                </div>
              )}
            </div>

            {/* Jobs Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Activity size={18} className="text-purple-600" />
                  Jobs
                </h2>
                <div className="flex gap-2 text-xs">
                  {[["Pending", "yellow", pending], ["Processing", "blue", processing],
                    ["Completed", "green", completed], ["Failed", "red", failed]].map(([label, color, count]) => (
                    <span key={label as string}
                      className={`px-2.5 py-1 rounded-full bg-${color}-100 text-${color}-700 font-medium`}>
                      {count} {label}
                    </span>
                  ))}
                </div>
              </div>
              {jobs.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                  <Activity size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No jobs yet. Enqueue your first job above.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <tr>
                        {["Seq", "Type", "Status", "Priority", "Retries", "Worker", "Enqueued", "Actions"].map(h => (
                          <th key={h} className="py-3 px-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map(job => (
                        <JobRow 
                          key={job.pubkey} 
                          job={job}
                          wallet={wallet}
                          onClaim={handleClaimJob}
                          onComplete={handleCompleteJob}
                          onFail={handleFailJob}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Architecture Note */}
        <div className="bg-gradient-to-br from-purple-50 to-teal-50 rounded-xl border border-purple-200 p-6">
          <h3 className="font-semibold text-purple-900 mb-2">How This Works</h3>
          <p className="text-sm text-purple-800 leading-relaxed">
            SolQueue replaces Redis + Bull with Solana's account model. Each job is a PDA
            (Program Derived Address) — a deterministic on-chain account. State transitions
            (Pending → Processing → Completed) happen via signed transactions, enforced by
            the Solana runtime. No trusted broker, no central server. Just math.
          </p>
          <div className="mt-3 flex gap-3">
            <a href="https://github.com/zakkycrypt01/solqueue" target="_blank" rel="noopener noreferrer"
               className="text-xs text-purple-700 underline">GitHub Repo</a>
            <a href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`}
               target="_blank" rel="noopener noreferrer"
               className="text-xs text-purple-700 underline">Devnet Program</a>
          </div>
        </div>
      </main>
    </div>
  );
}
