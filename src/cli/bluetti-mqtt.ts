#!/usr/bin/env node

import { BluettiMqttServer } from "@app/server.js";
import { createRuntime } from "@bluetooth/runtime.js";
import type { MqttTlsOptions } from "@broker/client.js";
import { ConsoleLogger, type LogLevel } from "@core/logger.js";
import { validateBluetoothAddress } from "./args.js";
import {
	parseIntervalSeconds,
	parseLogLevel,
	readConfigFile,
	readTlsFile,
	requireValue,
} from "./cli-config.js";
import { HelpError, UsageError } from "./errors.js";
import { installSignalHandlers, runCli } from "./process.js";

/** CLI usage text printed by `--help` or on argument errors. */
const HELP_TEXT = `Usage: bluetti-mqtt-node --broker <mqtt-url> [options] <BLUETOOTH_MAC...>
       bluetti-mqtt-node --config <path>

Options:
  --broker <mqtt-url>   MQTT broker URL, for example mqtt://127.0.0.1:1883
  --config <path>       Read runtime options from a JSON config file
  --username <value>    MQTT username
  --password <value>    MQTT password
  --mqtt-ca <path>      CA certificate PEM file for MQTT TLS
  --mqtt-cert <path>    Client certificate PEM file for MQTT mutual TLS
  --mqtt-key <path>     Client private key PEM file for MQTT mutual TLS
  --mqtt-servername <name>
                        TLS server name override
  --mqtt-insecure       Allow unauthorized MQTT TLS server certificates
  --interval <seconds>  Poll interval in seconds for continuous mode
  --log-level <level>   debug, info, warn, or error
  --once                Poll and publish once, then exit
  -h, --help            Show this help text
`;

/**
 * Resolves CLI/config precedence, constructs the server, and owns shutdown.
 *
 * @remarks
 * Parses command-line flags, optionally merges a JSON config file, constructs
 * a {@link BluettiMqttServer}, installs SIGINT/SIGTERM handlers, and runs the
 * bridge. The helper client is always disposed in the `finally` block.
 */
async function main(): Promise<void> {
	const args = await parseArgs(process.argv.slice(2));
	if (args.help) {
		throw new HelpError(HELP_TEXT);
	}

	if (!args.brokerUrl || args.addresses.length === 0) {
		throw new UsageError(HELP_TEXT);
	}

	const logger = new ConsoleLogger(args.logLevel);
	const runtime = await createRuntime();
	let removeSignalHandlers: (() => void) | undefined;
	try {
		const mqttOptions: {
			url: string;
			username?: string;
			password?: string;
			tls?: MqttTlsOptions;
		} = { url: args.brokerUrl };
		if (args.username !== undefined) {
			mqttOptions.username = args.username;
		}
		if (args.password !== undefined) {
			mqttOptions.password = args.password;
		}
		if (args.tls !== undefined) {
			mqttOptions.tls = args.tls;
		}

		const server = new BluettiMqttServer({
			addresses: args.addresses,
			transportFactory: runtime.transportFactory,
			intervalMs: args.intervalMs,
			runOnce: args.runOnce,
			mqtt: mqttOptions,
			logger,
		});

		removeSignalHandlers = installSignalHandlers(async () => {
			logger.info("Stopping bluetti-mqtt-node");
			await server.stop();
		});

		logger.info("Starting bluetti-mqtt-node", {
			addresses: args.addresses,
			brokerUrl: args.brokerUrl,
			intervalMs: args.intervalMs,
			runOnce: args.runOnce,
		});
		await server.run();
	} finally {
		removeSignalHandlers?.();
		runtime.dispose?.();
	}
}

/**
 * Parses command-line flags, then fills unspecified values from JSON config.
 *
 * @param argv - Command-line arguments (excluding the executable).
 * @returns Parsed options with CLI flags taking precedence over config file.
 * @throws {UsageError} When a flag value is missing or invalid.
 */
async function parseArgs(argv: readonly string[]): Promise<{
	brokerUrl: string | undefined;
	username: string | undefined;
	password: string | undefined;
	tls: MqttTlsOptions | undefined;
	intervalMs: number;
	runOnce: boolean;
	addresses: string[];
	help: boolean;
	logLevel: LogLevel;
}> {
	const addresses: string[] = [];
	let brokerUrl: string | undefined;
	let username: string | undefined;
	let password: string | undefined;
	let tlsCaPath: string | undefined;
	let tlsCertPath: string | undefined;
	let tlsKeyPath: string | undefined;
	let tlsServername: string | undefined;
	let tlsRejectUnauthorized: boolean | undefined;
	let intervalMs = 0;
	let runOnce = false;
	let help = false;
	let configPath: string | undefined;
	let logLevel: LogLevel = "info";

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		switch (token) {
			case "-h":
			case "--help":
				help = true;
				break;
			case "--broker":
				brokerUrl = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--config":
				configPath = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--username":
				username = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--password":
				password = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--mqtt-ca":
				tlsCaPath = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--mqtt-cert":
				tlsCertPath = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--mqtt-key":
				tlsKeyPath = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--mqtt-servername":
				tlsServername = requireValue(argv, index, HELP_TEXT);
				index += 1;
				break;
			case "--mqtt-insecure":
				tlsRejectUnauthorized = false;
				break;
			case "--interval":
				intervalMs = parseIntervalSeconds(
					requireValue(argv, index, HELP_TEXT),
					HELP_TEXT,
				);
				index += 1;
				break;
			case "--log-level":
				logLevel = parseLogLevel(
					requireValue(argv, index, HELP_TEXT),
					HELP_TEXT,
				);
				index += 1;
				break;
			case "--once":
				runOnce = true;
				break;
			default:
				if (token) {
					addresses.push(validateBluetoothAddress(token));
				}
				break;
		}
	}

	if (configPath !== undefined) {
		const config = await readConfigFile(configPath);
		brokerUrl = brokerUrl ?? config.broker;
		username = username ?? config.username;
		password = password ?? config.password;
		tlsCaPath = tlsCaPath ?? config.tls?.caPath;
		tlsCertPath = tlsCertPath ?? config.tls?.certPath;
		tlsKeyPath = tlsKeyPath ?? config.tls?.keyPath;
		tlsServername = tlsServername ?? config.tls?.servername;
		tlsRejectUnauthorized =
			tlsRejectUnauthorized ?? config.tls?.rejectUnauthorized;
		intervalMs =
			intervalMs > 0
				? intervalMs
				: parseIntervalSeconds(String(config.interval ?? 0), HELP_TEXT);
		runOnce = runOnce || config.once === true;
		logLevel = logLevel !== "info" ? logLevel : (config.logLevel ?? "info");
		if (addresses.length === 0 && config.addresses !== undefined) {
			addresses.push(
				...config.addresses.map((address) => validateBluetoothAddress(address)),
			);
		}
	}

	const tls = await buildMqttTlsOptions({
		caPath: tlsCaPath,
		certPath: tlsCertPath,
		keyPath: tlsKeyPath,
		rejectUnauthorized: tlsRejectUnauthorized,
		servername: tlsServername,
	});

	return {
		brokerUrl,
		username,
		password,
		tls,
		intervalMs,
		runOnce,
		addresses,
		help,
		logLevel,
	};
}

/**
 * Loads optional MQTT TLS file paths into mqtt.js TLS options.
 */
async function buildMqttTlsOptions(options: {
	caPath: string | undefined;
	certPath: string | undefined;
	keyPath: string | undefined;
	rejectUnauthorized: boolean | undefined;
	servername: string | undefined;
}): Promise<MqttTlsOptions | undefined> {
	const tls: MqttTlsOptions = {};
	if (options.caPath !== undefined) {
		tls.ca = await readTlsFile(options.caPath, "CA");
	}
	if (options.certPath !== undefined) {
		tls.cert = await readTlsFile(options.certPath, "client certificate");
	}
	if (options.keyPath !== undefined) {
		tls.key = await readTlsFile(options.keyPath, "client key");
	}
	if (options.rejectUnauthorized !== undefined) {
		tls.rejectUnauthorized = options.rejectUnauthorized;
	}
	if (options.servername !== undefined) {
		tls.servername = options.servername;
	}

	return Object.keys(tls).length > 0 ? tls : undefined;
}

runCli(main);
