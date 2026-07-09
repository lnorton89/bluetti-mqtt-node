/**
 * Interruptible sleep and per-address promise-chain mutex for device work.
 *
 * Owns the stop flag and sleep-waiter set so polling loops and connection
 * recovery can be woken cooperatively.
 */
export class DeviceWorkQueue {
	private stopRequested = false;
	private readonly sleepWaiters = new Set<() => void>();
	private readonly deviceQueues = new Map<string, Promise<void>>();

	get isStopRequested(): boolean {
		return this.stopRequested;
	}

	/** Resets the stop flag so a new run can start. */
	reset(): void {
		this.stopRequested = false;
	}

	/**
	 * Requests cooperative shutdown and wakes any loops currently sleeping.
	 */
	stop(): void {
		this.stopRequested = true;
		for (const wake of this.sleepWaiters) {
			wake();
		}
		this.sleepWaiters.clear();
	}

	/**
	 * Serializes async work per address using a promise-chain mutex.
	 */
	async enqueue<T>(address: string, work: () => Promise<T>): Promise<T> {
		const previous = this.deviceQueues.get(address) ?? Promise.resolve();
		let release!: () => void;

		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		const queued = previous.then(() => current);
		this.deviceQueues.set(address, queued);

		await previous;

		try {
			return await work();
		} finally {
			release();
			if (this.deviceQueues.get(address) === queued) {
				this.deviceQueues.delete(address);
			}
		}
	}

	/**
	 * Sleeps for `ms` milliseconds, interruptible by {@link stop}.
	 */
	async sleep(ms: number): Promise<void> {
		if (this.stopRequested || ms <= 0) {
			return;
		}

		await new Promise<void>((resolve) => {
			let finished = false;
			let timer: ReturnType<typeof setTimeout> | undefined;

			const done = (): void => {
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
