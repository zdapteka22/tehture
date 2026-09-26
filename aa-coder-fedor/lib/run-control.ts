/** One live job per chat thread. A flicker of the window must not kill the work. */

export class JobAbortedError extends Error {
  constructor(message = "Остановлено.") {
    super(message);
    this.name = "JobAbortedError";
  }
}

type Job = AbortController;

const jobs = new Map<string, Job>();
let onJobEnd: ((id: string) => void) | null = null;

function keyOf(threadId?: string | null): string {
  return String(threadId || "").trim() || "default";
}

export function hasActiveJob(threadId?: string | null): boolean {
  const job = jobs.get(keyOf(threadId));
  return Boolean(job && !job.signal.aborted);
}

export function beginJob(threadId?: string | null): Job {
  const id = keyOf(threadId);
  const prev = jobs.get(id);
  if (prev && !prev.signal.aborted) prev.abort();
  try {
    onJobEnd?.(id);
  } catch {
    // ignore
  }
  const next = new AbortController();
  jobs.set(id, next);
  return next;
}

export function setJobAbortHook(fn: ((id: string) => void) | null): void {
  onJobEnd = fn;
}

export function abortJob(threadId?: string | null, expected?: Job | null): boolean {
  const id = keyOf(threadId);
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
  if (jobs.get(id) === expected) jobs.delete(id);
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
