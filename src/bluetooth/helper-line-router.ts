import {
	DISPOSED_OBJECT_ERROR_TEXT,
	HELPER_ERROR_COMMAND_FAILED,
	HELPER_EVENT_NOTIFICATION,
	HELPER_MESSAGE_TYPE_EVENT,
	MISSING_CHARACTERISTIC_ERROR_TEXT,
	UNREACHABLE_ERROR_TEXT,
} from "./constants.js";
import { BadConnectionError } from "./errors.js";
import type {
	HelperEvent,
	HelperMessage,
	HelperNotificationEvent,
} from "./helper-protocol.js";
import type { PendingRequest } from "./helper-request.js";

/** Internal notification event routed to transport subscribers. */
export interface HelperNotification {
	/** Helper session ID that owns the subscription. */
	readonly sessionId: string;
	/** Characteristic UUID that produced the notification. */
	readonly uuid: string;
	/** Raw notification bytes. */
	readonly data: Uint8Array;
}

export interface HelperLineRouterState {
	readonly pending: Map<string, PendingRequest>;
	readonly notificationListeners: Set<(event: HelperNotification) => void>;
	readyResolved: boolean;
}

/**
 * Parses one stdout line and routes ready, notification, response, and error messages.
 */
export function routeHelperLine(
	state: HelperLineRouterState,
	line: string,
	onReady: () => void,
	onReadyError: (reason?: unknown) => void,
): void {
	let message: HelperMessage;
	try {
		message = JSON.parse(line) as HelperMessage;
	} catch (error) {
		if (!state.readyResolved) {
			onReadyError(error);
		}
		return;
	}

	if (message.type === HELPER_MESSAGE_TYPE_EVENT) {
		routeHelperEvent(state, message, onReady);
		return;
	}

	if (message.id === undefined) {
		return;
	}

	const pending = state.pending.get(message.id);
	if (!pending) {
		return;
	}

	state.pending.delete(message.id);
	clearTimeout(pending.timeout);
	if (message.type === "response") {
		pending.resolve(message.payload);
	} else {
		pending.reject(
			createHelperError(message.error.code, message.error.message),
		);
	}
}

function routeHelperEvent(
	state: HelperLineRouterState,
	message: HelperEvent,
	onReady: () => void,
): void {
	if (message.name === "ready") {
		state.readyResolved = true;
		onReady();
		return;
	}

	if (message.name !== "notification" || !isHelperNotificationEvent(message)) {
		return;
	}

	const payload = message.payload;
	if (payload === undefined) {
		return;
	}

	const event: HelperNotification = {
		sessionId: payload.sessionId,
		uuid: payload.uuid,
		data: new Uint8Array(Buffer.from(payload.dataBase64, "base64")),
	};
	for (const listener of state.notificationListeners) {
		listener(event);
	}
}

function createHelperError(code: string, message: string): Error {
	const details = `${code}: ${message}`;
	if (isRecoverableBluetoothConnectionError(code, message)) {
		return new BadConnectionError(details);
	}

	return new Error(details);
}

function isRecoverableBluetoothConnectionError(
	code: string,
	message: string,
): boolean {
	if (code !== HELPER_ERROR_COMMAND_FAILED) {
		return false;
	}

	const normalizedMessage = message.toLowerCase();
	return (
		normalizedMessage.includes(DISPOSED_OBJECT_ERROR_TEXT) ||
		normalizedMessage.includes(UNREACHABLE_ERROR_TEXT) ||
		(normalizedMessage.includes("characteristic") &&
			normalizedMessage.includes(MISSING_CHARACTERISTIC_ERROR_TEXT))
	);
}

function isHelperNotificationEvent(
	message: HelperMessage,
): message is HelperNotificationEvent {
	return (
		message.type === HELPER_MESSAGE_TYPE_EVENT &&
		message.name === HELPER_EVENT_NOTIFICATION
	);
}
