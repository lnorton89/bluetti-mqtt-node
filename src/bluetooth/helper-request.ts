import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { BadConnectionError } from "./errors.js";
import type { HelperRequest } from "./helper-protocol.js";

/** Internal state for one pending helper request. */
export interface PendingRequest {
	/** Resolves with the response payload. */
	resolve: (value: Record<string, unknown> | undefined) => void;
	/** Rejects with a timeout or helper error. */
	reject: (reason?: unknown) => void;
	/** Timeout handle for the request deadline. */
	timeout?: ReturnType<typeof setTimeout>;
}

interface SendHelperRequestOptions {
	readonly disposed: boolean;
	readonly ready: Promise<void>;
	readonly pending: Map<string, PendingRequest>;
	readonly stdin: Writable;
	readonly command: string;
	readonly argumentsObject?: Record<string, unknown>;
	readonly timeoutMs: number;
}

/**
 * Sends a JSON-line helper request and registers response correlation state.
 *
 * @throws {Error} When the helper client has been disposed.
 * @throws {BadConnectionError} When the request deadline expires.
 */
export async function sendHelperRequest({
	disposed,
	ready,
	pending,
	stdin,
	command,
	argumentsObject,
	timeoutMs,
}: SendHelperRequestOptions): Promise<Record<string, unknown> | undefined> {
	if (disposed) {
		throw new Error("Windows BLE helper disposed");
	}

	await ready;

	const id = randomUUID();
	const request: HelperRequest = { id, command };
	if (argumentsObject !== undefined) {
		(
			request as HelperRequest & { arguments: Record<string, unknown> }
		).arguments = argumentsObject;
	}

	const response = new Promise<Record<string, unknown> | undefined>(
		(resolve, reject) => {
			const timeout = setTimeout(() => {
				if (pending.delete(id)) {
					reject(
						new BadConnectionError(
							`Windows BLE helper request timed out: ${command}`,
						),
					);
				}
			}, timeoutMs);
			pending.set(id, { resolve, reject, timeout });
		},
	);

	try {
		stdin.write(`${JSON.stringify(request)}\n`);
	} catch (error) {
		const entry = pending.get(id);
		if (entry !== undefined) {
			clearTimeout(entry.timeout);
			pending.delete(id);
		}
		throw error;
	}
	return response;
}

/** Rejects all pending requests with the given error and clears the map. */
export function rejectPendingRequests(
	pending: Map<string, PendingRequest>,
	error: unknown,
): void {
	for (const entry of pending.values()) {
		clearTimeout(entry.timeout);
		entry.reject(error);
	}
	pending.clear();
}
