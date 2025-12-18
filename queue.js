import { config } from './config.js';

// Simple semaphore-based request queue for concurrency limiting
class RequestQueue {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  // Get current stats
  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }

  // Acquire a slot (returns a promise that resolves when slot is available)
  async acquire() {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    // Wait in queue
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  // Release a slot
  release() {
    if (this.queue.length > 0) {
      // Give slot to next waiting request
      const next = this.queue.shift();
      next();
    } else {
      this.running--;
    }
  }

  // Execute a function with concurrency limiting
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Singleton instance for browser page requests
export const pageQueue = new RequestQueue(config.browser.maxConcurrentPages);

// Helper function for logging queue status
export const logQueueStatus = () => {
  const stats = pageQueue.getStats();
  if (config.logging.debug) {
    console.log(`[${new Date().toISOString()}] Queue: ${stats.running}/${stats.maxConcurrent} running, ${stats.queued} queued`);
  }
};
