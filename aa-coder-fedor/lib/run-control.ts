/**
 * One live job per chat thread.
 * A flicker of the window must not kill the work.
 * A follow-up («и») is queued; it does not abort the running turn.
 * Stop clears the queue instead of turning it into a new job.
 */

export class JobAbortedError extends Error {
  constructor(message = "Остановлено.") {
    super(message);
    this.name = "JobAbortedError";
  }
}

type Job = AbortController;

const jobs = new Map<string, Job>();
const interjections = new Map<string, string[]>();
let onJobEnd: ((id: string) => void) | null = null;

function keyOf(threadId?: string | null): string {
  return String(threadId || "").trim() || "default";
}

export function hasActiveJob(threadId?: string | null): boolean {
  const job = jobs.get(keyOf(threadId));
  return Boolean(job && !job.signal.aborted);
}

/** Start a job only when the thread is idle. A live turn is not aborted. */
export function beginJob(threadId?: string | null): Job {
  const id = keyOf(threadId);
  const prev = jobs.get(id);
  if (prev && !prev.signal.aborted) return prev;
  try {
    onJobEnd?.(id);
  } catch {
    // ignore
  }
  const next = new AbortController();
  jobs.set(id, next);
  return next;
}

export function enqueueInterjection(threadId: string | null | undefined, text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (!hasActiveJob(threadId)) return false;
  const id = keyOf(threadId);
  const q = interjections.get(id) || [];
  q.push(raw);
  interjections.set(id, q);
  return true;
}

export function drainInterjections(threadId?: string | null): string[] {
  const id = keyOf(threadId);
  const q = interjections.get(id) || [];
  interjections.delete(id);
  return q;
}

/** Attach a follow-up to the live turn. False = thread is idle, caller should start a job. */
export function attachToRunningJob(threadId: string | null | undefined, text: string): boolean {
  return enqueueInterjection(threadId, text);
}

export function setJobAbortHook(fn: ((id: string) => void) | null): void {
  onJobEnd = fn;
}

export function abortJob(threadId?: string | null, expected?: Job | null): boolean {
  const id = keyOf(threadId);
  // Grok Cancel: clear, don't flush — a stop must not become a new prompt turn
  interjections.delete(id);
  const job = jobs.get(id);
  if (!job) {
    try {
      onJobEnd?.(id);
    } catch {
      // ignore
    }
    return false;
  }
  if (expected && job !== expected) return false;
  if (!job.signal.aborted) job.abort();
  jobs.delete(id);
  try {
    onJobEnd?.(id);
  } catch {
    // ignore
  }
  return true;
}

export function endJob(threadId?: string | null, expected?: Job | null): void {
  const id = keyOf(threadId);
  if (jobs.get(id) === expected) {
    jobs.delete(id);
    if (!interjections.get(id)?.length) interjections.delete(id);
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof JobAbortedError) return true;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "AbortError" || name === "JobAbortedError" || /aborted|Остановлено/i.test(message);
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new JobAbortedError();
}

export function withTimeout(ms: number, parent?: AbortSignal | null): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    if (!ctrl.signal.aborted) ctrl.abort();
  }, Math.max(1000, ms));
  const onParent = () => {
    if (!ctrl.signal.aborted) ctrl.abort();
  };
  parent?.addEventListener("abort", onParent, { once: true });
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}
