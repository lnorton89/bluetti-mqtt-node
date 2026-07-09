/**
 * Interruptible sleep and per-address promise-chain mutex for device work.
 *
 * Owns the stop flag and sleep-waiter set so polling loops and connection
 * recovery can be woken cooperatively.
 */
export declare class DeviceWorkQueue {
    private stopRequested;
    private readonly sleepWaiters;
    private readonly deviceQueues;
    get isStopRequested(): boolean;
    /** Resets the stop flag so a new run can start. */
    reset(): void;
    /**
     * Requests cooperative shutdown and wakes any loops currently sleeping.
     */
    stop(): void;
    /**
     * Serializes async work per address using a promise-chain mutex.
     */
    enqueue<T>(address: string, work: () => Promise<T>): Promise<T>;
    /**
     * Sleeps for `ms` milliseconds, interruptible by {@link stop}.
     */
    sleep(ms: number): Promise<void>;
}
