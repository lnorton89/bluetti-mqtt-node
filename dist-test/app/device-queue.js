/**
 * Interruptible sleep and per-address promise-chain mutex for device work.
 *
 * Owns the stop flag and sleep-waiter set so polling loops and connection
 * recovery can be woken cooperatively.
 */
export class DeviceWorkQueue {
    stopRequested = false;
    sleepWaiters = new Set();
    deviceQueues = new Map();
    get isStopRequested() {
        return this.stopRequested;
    }
    /** Resets the stop flag so a new run can start. */
    reset() {
        this.stopRequested = false;
    }
    /**
     * Requests cooperative shutdown and wakes any loops currently sleeping.
     */
    stop() {
        this.stopRequested = true;
        for (const wake of this.sleepWaiters) {
            wake();
        }
        this.sleepWaiters.clear();
    }
    /**
     * Serializes async work per address using a promise-chain mutex.
     */
    async enqueue(address, work) {
        const previous = this.deviceQueues.get(address) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        const queued = previous.then(() => current);
        this.deviceQueues.set(address, queued);
        await previous;
        try {
            return await work();
        }
        finally {
            release();
            if (this.deviceQueues.get(address) === queued) {
                this.deviceQueues.delete(address);
            }
        }
    }
    /**
     * Sleeps for `ms` milliseconds, interruptible by {@link stop}.
     */
    async sleep(ms) {
        if (this.stopRequested || ms <= 0) {
            return;
        }
        await new Promise((resolve) => {
            let finished = false;
            let timer;
            const done = () => {
                if (finished) {
                    return;
                }
                finished = true;
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                this.sleepWaiters.delete(done);
                resolve();
            };
            this.sleepWaiters.add(done);
            timer = setTimeout(done, ms);
        });
    }
}
