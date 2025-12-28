import logger from '../lib/logger';

// Simple in-memory job queue for standalone operation
interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  error?: string;
}

class SimpleQueue<T = any> {
  private jobs: Map<string, Job<T>> = new Map();
  private processors: Map<string, (job: Job<T>) => Promise<void>> = new Map();
  private processing = false;

  constructor(public name: string) {}

  async add(jobName: string, data: T): Promise<Job<T>> {
    const job: Job<T> = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: jobName,
      data,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      status: 'waiting',
    };

    this.jobs.set(job.id, job);
    logger.debug({ queue: this.name, jobId: job.id, jobName }, 'Job added');
    
    // Start processing if not already processing
    if (!this.processing) {
      setImmediate(() => this.processJobs());
    }

    return job;
  }

  process(jobName: string, handler: (job: Job<T>) => Promise<void>) {
    this.processors.set(jobName, handler);
    logger.info({ queue: this.name, jobName }, 'Job processor registered');
  }

  private async processJobs() {
    if (this.processing) return;
    this.processing = true;

    try {
      for (const [jobId, job] of this.jobs.entries()) {
        if (job.status !== 'waiting') continue;

        const processor = this.processors.get(job.name);
        if (!processor) continue;

        job.status = 'active';
        job.attempts++;
        logger.debug({ queue: this.name, jobId, jobName: job.name }, 'Job active');

        try {
          await processor(job);
          job.status = 'completed';
          logger.info({ queue: this.name, jobId, jobName: job.name }, 'Job completed');
          
          // Remove completed jobs after a delay
          setTimeout(() => this.jobs.delete(jobId), 60000);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          job.error = errorMessage;

          if (job.attempts >= job.maxAttempts) {
            job.status = 'failed';
            logger.error({ queue: this.name, jobId, jobName: job.name, error: errorMessage }, 'Job failed');
          } else {
            job.status = 'waiting';
            logger.warn({ queue: this.name, jobId, jobName: job.name, attempts: job.attempts, error: errorMessage }, 'Job retry');
          }
        }
      }
    } finally {
      this.processing = false;
      
      // Check if there are more waiting jobs
      const hasWaitingJobs = Array.from(this.jobs.values()).some(j => j.status === 'waiting');
      if (hasWaitingJobs) {
        setTimeout(() => this.processJobs(), 100);
      }
    }
  }

  on(event: string, _handler: (data: any) => void) {
    // Simple event emitter stub for compatibility
    logger.debug({ queue: this.name, event }, 'Event listener registered');
  }
}

// Create queues
export const searchQueue = new SimpleQueue('search');
export const evaluationQueue = new SimpleQueue('evaluation');
export const pricingQueue = new SimpleQueue('pricing');

// Additional queues for worker pipeline
export const ebayFetchQueue = new SimpleQueue('ebay-fetch');
export const parseQueue = new SimpleQueue('parse');
export const gradeQueue = new SimpleQueue('grade');
export const priceQueue = new SimpleQueue('price');
export const scoreQueue = new SimpleQueue('score');

logger.info('Job queues initialized (in-memory)');
