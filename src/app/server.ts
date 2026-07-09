import { MultiDeviceManager } from "@bluetooth/manager.js";
import type { BluetoothTransportFactory } from "@bluetooth/transport.js";
import type { DeviceCommand } from "@core/commands.js";
import { EventBus } from "@core/event-bus.js";
import { ConsoleLogger, type Logger } from "@core/logger.js";
import type { BluettiDevice } from "@devices/device.js";
import {
	BluettiMqttBridge,
	type BluettiMqttClientOptions,
} from "@mqtt/client.js";
import { DeviceHandler, type PollingOptions } from "./device-handler.js";

/**
 * Dependencies and polling behavior used to construct a bridge server.
 *
 * @see BluettiMqttServer
 */
export interface ServerOptions {
	/** Bluetooth MAC addresses of devices to poll. */
	readonly addresses: readonly string[];
	/** Factory that creates per-device GATT transports. */
	readonly transportFactory: BluetoothTransportFactory;
	/** MQTT broker connection options. */
	readonly mqtt: BluettiMqttClientOptions;
	/** Legacy polling interval in milliseconds (0 = defaults). Prefer `polling`. */
	readonly intervalMs?: number;
	/** Fine-grained polling timing and backoff configuration. */
	readonly polling?: PollingOptions;
	/** When `true`, performs one poll cycle and exits. */
	readonly runOnce?: boolean;
	/** Optional logger; defaults to `ConsoleLogger` at `info` level. */
	readonly logger?: Logger;
}

/**
 * Coordinates MQTT startup, device polling, and best-effort shutdown.
 *
 * @remarks
 * Composes the {@link MultiDeviceManager}, {@link DeviceHandler}, event bus,
 * and {@link BluettiMqttBridge} into the long-running application lifecycle
 * used by the CLI. Cleanup failures are logged independently so one failed
 * transport cannot prevent the remaining resources from being released.
 *
 * @example
 * ```ts
 * const server = new BluettiMqttServer({
 *   addresses: ["24:4C:AB:2C:24:8E"],
 *   transportFactory: runtime.transportFactory,
 *   mqtt: { url: "mqtt://127.0.0.1:1883" },
 * });
 * await server.run();
 * ```
 *
 * @see DeviceHandler
 * @see BluettiMqttBridge
 */
export class BluettiMqttServer {
	/** Event bus carrying parser telemetry and command messages. */
	readonly bus = new EventBus<BluettiDevice, BluettiDevice, DeviceCommand>();
	/** Device session manager owning BLE connections. */
	readonly manager: MultiDeviceManager;
	/** Polling handler that reads registers and publishes telemetry. */
	readonly deviceHandler: DeviceHandler;
	/** MQTT bridge that publishes state and ingests commands. */
	readonly mqttBridge: BluettiMqttBridge;
	/** Structured logger for server lifecycle events. */
	readonly logger: Logger;

	/**
	 * Creates a bridge server from the given options.
	 *
	 * @param options - Server dependencies, MQTT config, and polling behavior.
	 */
	constructor(options: ServerOptions) {
		this.logger = options.logger ?? new ConsoleLogger("info");
		this.manager = new MultiDeviceManager(
			options.addresses,
			options.transportFactory,
		);
		this.deviceHandler = new DeviceHandler(
			this.manager,
			this.bus,
			options.polling ?? options.intervalMs ?? 0,
			options.runOnce ?? false,
			this.logger,
		);
		this.mqttBridge = new BluettiMqttBridge(
			this.bus,
			options.mqtt,
			undefined,
			this.logger,
		);
	}

	/**
	 * Connects all devices without starting the long-running polling loop.
	 *
	 * @remarks
	 * Useful for one-shot mode or when the caller wants to inspect device state
	 * before polling begins.
	 */
	async connectAll(): Promise<void> {
		await this.deviceHandler.connectAll();
	}

	/**
	 * Requests cooperative polling shutdown.
	 *
	 * @remarks
	 * Signals the {@link DeviceHandler} to stop and wakes any sleeping loops.
	 * The actual cleanup (Bluetooth disconnect, MQTT close) happens in the
	 * `finally` block of {@link run}.
	 */
	async stop(): Promise<void> {
		this.deviceHandler.stop();
	}

	/**
	 * Runs until one-shot completion, a stop request, or an unexpected failure.
	 *
	 * @remarks
	 * Starts the MQTT bridge, then the device polling loop. In the `finally`
	 * block, Bluetooth sessions and the MQTT connection are cleaned up
	 * independently — failures in one do not prevent cleanup of the other.
	 */
	async run(): Promise<void> {
		await this.mqttBridge.run();
		this.logger.info("Starting device polling", {
			addresses: this.manager.addresses,
		});
		try {
			await this.deviceHandler.run();
		} finally {
			try {
				await this.manager.disconnectAll();
			} catch (error) {
				this.logger.warn("Bluetooth cleanup failed", {
					error: formatError(error),
				});
			}
			try {
				await this.mqttBridge.stop();
			} catch (error) {
				this.logger.warn("MQTT cleanup failed", { error: formatError(error) });
			}
			this.logger.info("Stopped device polling", {
				addresses: this.manager.addresses,
			});
		}
	}
}

/**
 * Extracts a display string from an unknown error, handling `AggregateError`.
 *
 * @param error - Value to format.
 * @returns Semicolon-joined messages for `AggregateError`, or `error.message`
 *   for `Error`, otherwise `String(error)`.
 */
function formatError(error: unknown): string {
	if (error instanceof AggregateError) {
		return error.errors
			.map((entry) => (entry instanceof Error ? entry.message : String(entry)))
			.join("; ");
	}

	return error instanceof Error ? error.message || error.name : String(error);
}
