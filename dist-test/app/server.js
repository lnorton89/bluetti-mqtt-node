import { MultiDeviceManager } from "@bluetooth/manager.js";
import { EventBus } from "@core/event-bus.js";
import { ConsoleLogger } from "@core/logger.js";
import { BluettiMqttBridge } from "@mqtt/client.js";
import { DeviceHandler } from "./device-handler.js";
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
    bus = new EventBus();
    /** Device session manager owning BLE connections. */
    manager;
    /** Polling handler that reads registers and publishes telemetry. */
    deviceHandler;
    /** MQTT bridge that publishes state and ingests commands. */
    mqttBridge;
    /** Structured logger for server lifecycle events. */
    logger;
    /**
     * Creates a bridge server from the given options.
     *
     * @param options - Server dependencies, MQTT config, and polling behavior.
     */
    constructor(options) {
        this.logger = options.logger ?? new ConsoleLogger("info");
        this.manager = new MultiDeviceManager(options.addresses, options.transportFactory);
        this.deviceHandler = new DeviceHandler(this.manager, this.bus, options.polling ?? options.intervalMs ?? 0, options.runOnce ?? false, this.logger);
        this.mqttBridge = new BluettiMqttBridge(this.bus, options.mqtt, undefined, this.logger);
    }
    /**
     * Connects all devices without starting the long-running polling loop.
     *
     * @remarks
     * Useful for one-shot mode or when the caller wants to inspect device state
     * before polling begins.
     */
    async connectAll() {
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
    async stop() {
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
    async run() {
        await this.mqttBridge.run();
        this.logger.info("Starting device polling", { addresses: this.manager.addresses });
        try {
            await this.deviceHandler.run();
        }
        finally {
            try {
                await this.manager.disconnectAll();
            }
            catch (error) {
                this.logger.warn("Bluetooth cleanup failed", { error: formatError(error) });
            }
            try {
                await this.mqttBridge.stop();
            }
            catch (error) {
                this.logger.warn("MQTT cleanup failed", { error: formatError(error) });
            }
            this.logger.info("Stopped device polling", { addresses: this.manager.addresses });
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
function formatError(error) {
    if (error instanceof AggregateError) {
        return error.errors
            .map((entry) => entry instanceof Error ? entry.message : String(entry))
            .join("; ");
    }
    return error instanceof Error ? error.message || error.name : String(error);
}
