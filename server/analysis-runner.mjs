import { Worker } from 'node:worker_threads';

const DEFAULT_WORKER_URL = new URL('./analysis-worker.mjs', import.meta.url);

export function createAnalysisRunner({ workerFactory = () => new Worker(DEFAULT_WORKER_URL) } = {}) {
  let worker = null;
  let nextId = 0;
  let closed = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const [id, task] of pending) {
      clearTimeout(task.timer);
      pending.delete(id);
      task.reject(error);
    }
  }

  function ensureWorker() {
    if (worker) return worker;
    const instance = workerFactory();
    worker = instance;

    instance.on('message', message => {
      const task = pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });

    instance.on('error', error => {
      if (worker === instance) worker = null;
      rejectPending(error);
    });

    instance.on('exit', code => {
      if (worker === instance) worker = null;
      if (code !== 0) rejectPending(new Error(`Analysis worker exited with code ${code}.`));
    });

    return instance;
  }

  return Object.freeze({
    analyze(file, source, timeoutMs) {
      if (closed) return Promise.reject(new Error('Analysis runner is already closed.'));
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
        return Promise.reject(new Error('Analysis timeout must be a positive integer.'));
      }

      const instance = ensureWorker();
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
          if (!pending.has(id)) return;
          pending.delete(id);
          if (worker === instance) worker = null;
          try { await instance.terminate(); } catch { /* The worker may already have exited. */ }
          resolve({
            findings: [],
            parse_error: null,
            skipped_reason: 'analysis_timeout',
            timed_out: true
          });
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });
        try {
          instance.postMessage({ id, file, source });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      const instance = worker;
      worker = null;
      rejectPending(new Error('Analysis runner closed before work completed.'));
      if (instance) await instance.terminate();
    }
  });
}
