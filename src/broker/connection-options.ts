import type { IClientOptions } from "mqtt";
import type { BluettiMqttClientOptions } from "./client.js";

/**
 * Builds mqtt.js connection options from bridge configuration.
 *
 * Keeping this separate from subscription/listener startup makes credential and
 * TLS mapping testable without exercising the long-running bridge lifecycle.
 */
export function buildMqttConnectionOptions(
	options: BluettiMqttClientOptions,
): IClientOptions {
	const connectOptions: IClientOptions = {};
	if (options.username !== undefined) {
		connectOptions.username = options.username;
	}
	if (options.password !== undefined) {
		connectOptions.password = options.password;
	}
	if (options.tls !== undefined) {
		if (options.tls.ca !== undefined) {
			connectOptions.ca = options.tls.ca;
		}
		if (options.tls.cert !== undefined) {
			connectOptions.cert = options.tls.cert;
		}
		if (options.tls.key !== undefined) {
			connectOptions.key = options.tls.key;
		}
		if (options.tls.rejectUnauthorized !== undefined) {
			connectOptions.rejectUnauthorized = options.tls.rejectUnauthorized;
		}
		if (options.tls.servername !== undefined) {
			connectOptions.servername = options.tls.servername;
		}
	}
	return connectOptions;
}
