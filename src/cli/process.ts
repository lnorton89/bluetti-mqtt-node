import { SIGNAL_INTERRUPT, SIGNAL_TERMINATE } from "./constants.js";
import { HelpError, UsageError } from "./errors.js";

/**
 * Runs a CLI main function with consistent exit-code and error rendering.
 *
 * @param main - Async entry point for the CLI command.
 *
 * @remarks
 * Catches {@link HelpError} (prints to stdout, exit 0), {@link UsageError}
 * (prints to stderr, exit 1), and all other errors (prints stack to stderr,
 * exit 1). Uses `process.exitCode` rather than `process.exit` so pending I/O
 * can flush.
 */
export function runCli(main: () => Promise<void>): void {
	void main().catch((error: unknown) => {
		if (error instanceof HelpError) {
			console.log(error.message);
			process.exitCode = 0;
			return;
		}

		if (error instanceof UsageError) {
			console.error(error.message);
			process.exitCode = 1;
			return;
		}

		const message =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		console.error(message);
		process.exitCode = 1;
	});
}

/**
 * Installs idempotent SIGINT/SIGTERM cleanup and returns a listener disposer.
 *
 * @param onSignal - Cleanup callback invoked on the first signal.
 * @returns A function that removes the signal handlers.
 *
 * @remarks
 * The handler is idempotent: repeated signals are ignored after the first
 * invocation. Errors from `onSignal` are printed to stderr with exit code 1.
 */
export function installSignalHandlers(
	onSignal: () => void | Promise<void>,
): () => void {
	let stopping = false;

	const handler = (): void => {
		if (stopping) {
			return;
		}

		stopping = true;
		void Promise.resolve(onSignal()).catch((error: unknown) => {
			const message =
				error instanceof Error ? (error.stack ?? error.message) : String(error);
			console.error(message);
			process.exitCode = 1;
		});
	};

	process.on(SIGNAL_INTERRUPT, handler);
	process.on(SIGNAL_TERMINATE, handler);

	return () => {
		process.off(SIGNAL_INTERRUPT, handler);
		process.off(SIGNAL_TERMINATE, handler);
	};
}
