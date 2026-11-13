import { parentPort } from 'node:worker_threads';
import { analyzeSource } from './analysis-engine.mjs';

if (!parentPort) {
  throw new Error('Analysis worker must run inside a worker thread.');
}

parentPort.on('message', ({ id, file, source }) => {
  try {
    parentPort.postMessage({ id, result: analyzeSource(file, source) });
  } catch {
    parentPort.postMessage({
      id,
      error: 'Isolated AST analysis failed unexpectedly.'
    });
  }
});
