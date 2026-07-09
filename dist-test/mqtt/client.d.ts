import { ReadHoldingRegisters, type DeviceCommand } from "@core/commands.js";
import type { EventBus } from "@core/event-bus.js";
import { type Logger } from "@core/logger.js";
import type { BluettiDevice } from "@devices/device.js";
export type { MqttClient, PublishedMqttMessage, ReceivedMqttMessage } from "./basic-client.js";
export { BasicMqttClient } from "./basic-client.js";
/**
 * Connection options for the Bluetti MQTT bridge.
 *
 * @see BluettiMqttBridge
 */
export interface BluettiMqttClientOptions {
    /** MQTT broker URL (e.g. `mqtt://127.0.0.1:1883`). */
    readonly url: string;
    /** Optional username for broker authentication. */
    readonly username?: string;
    /** Optional password for broker authentication. */
    readonly password?: string;
}
/**
 * Subset of mqtt.js used by the bridge, exposed for deterministic tests.
 *
 * @remarks
 * This interface captures only the methods the bridge calls on the raw
 * client, enabling mock injection in tests.
 *
 * @see BluettiMqttBridge
 * @see MqttConnector
 */
export interface RawMqttClientLike {
    /**
     * Subscribes to a topic pattern.
     *
     * @param topic - Topic or wildcard pattern to subscribe to.
     */
    subscribe(topic: string): Promise<unknown> | unknown;
    /**
     * Registers a message event listener.
     *
     * @param event - Event name (always `"message"`).
     * @param listener - Callback receiving the topic and payload buffer.
     */
    on(event: "message", listener: (topic: string, payload: Buffer) => void): unknown;
    /**
     * Removes a previously registered message event listener.
     *
     * @param event - Event name (always `"message"`).
     * @param listener - The listener to remove.
     */
    off(event: "message", listener: (topic: string, payload: Buffer) => void): unknown;
    /**
     * Publishes a string payload to a topic.
     *
     * @param topic - MQTT topic to publish to.
     * @param payload - String payload to send.
     */
    publish(topic: string, payload: string): Promise<unknown> | unknown;
    /** Asynchronously closes the MQTT connection. */
    endAsync(): Promise<unknown>;
}
/**
 * Injectable connector used to create a raw MQTT client.
 *
 * @remarks
 * The default implementation uses `mqtt.connectAsync`. Tests inject a mock
 * connector to avoid network I/O.
 *
 * @see BluettiMqttBridge
 */
export type MqttConnector = (url: string, options: {
    username?: string;
    password?: string;
}) => Promise<RawMqttClientLike>;
/**
 * Publishes parsed telemetry and dispatches validated MQTT commands.
 *
 * @remarks
 * Startup is transactional: if subscription or listener setup fails, every
 * installed listener is removed and the raw client is closed before the error
 * escapes.
 *
 * Telemetry is published to `bluetti/state/<MODEL>-<SERIAL>/<FIELD>` topics.
 * Commands are received on `bluetti/command/<MODEL>-<SERIAL>/<FIELD>` topics
 * and dispatched through the event bus to the device handler.
 *
 * @example
 * ```ts
 * const bridge = new BluettiMqttBridge(bus, { url: "mqtt://127.0.0.1:1883" });
 * await bridge.run();
 * // ... polling publishes telemetry via the bus ...
 * await bridge.stop();
 * ```
 *
 * @see EventBus
 * @see DeviceHandler
 */
export declare class BluettiMqttBridge {
    private readonly bus;
    private readonly options;
    private readonly connector;
    private readonly logger;
    /** Devices discovered from parser messages, keyed by `MODEL-SERIAL`. */
    private readonly devices;
    /** Connected raw MQTT client, or `null` when not running. */
    private rawClient;
    /** Disposer for the event bus parser listener, or `null` when not installed. */
    private removeParserListener;
    /** Registered raw MQTT message listener, or `null` when not installed. */
    private messageListener;
    /**
     * Creates an MQTT bridge connected to an event bus.
     *
     * @param bus - Event bus carrying parser telemetry and command messages.
     * @param options - MQTT broker connection options.
     * @param connector - Injectable MQTT connector (defaults to `mqtt.connectAsync`).
     * @param logger - Optional logger; defaults to `ConsoleLogger` at `info`.
     */
    constructor(bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>, options: BluettiMqttClientOptions, connector?: MqttConnector, logger?: Logger);
    /**
     * Connects to the broker, subscribes to command topics, and installs bus
     * listeners.
     *
     * @throws {Error} When the bridge is already running.
     * @throws {Error} When the MQTT connection fails.
     *
     * @remarks
     * If subscription or listener installation fails after connecting, all
     * installed resources are cleaned up before the error propagates.
     */
    run(): Promise<void>;
    /**
     * Removes bus listeners and closes the MQTT connection.
     *
     * @remarks
     * JavaScript callbacks are released before awaiting network shutdown so a
     * failing `endAsync` cannot leave the bridge logically connected. Cleanup
     * failures are collected into an {@link AggregateError}.
     */
    stop(): Promise<void>;
    /**
     * Publishes parsed telemetry fields to individual state topics and a `_raw` snapshot.
     *
     * @param message - Parser message containing the device and decoded fields.
     */
    private handleParserMessage;
    /**
     * Parses an MQTT command topic, validates the setter, and dispatches the command.
     *
     * @param topic - MQTT topic string.
     * @param payload - Raw command payload bytes.
     *
     * @remarks
     * Silently ignores topics that don't match the command pattern, unknown
     * devices, or fields without setters. Invalid payloads are caught at the
     * call site and logged as warnings.
     */
    private handleIncomingCommand;
    /**
     * Returns the connected raw client or throws when not connected.
     *
     * @returns The active raw MQTT client.
     * @throws {Error} When the bridge is not connected.
     */
    private requireClient;
    /**
     * Releases all JavaScript callbacks, then closes the raw MQTT connection.
     *
     * @param client - Raw client to clean up.
     * @throws {AggregateError} When one or more cleanup steps fail.
     */
    private cleanupClient;
}
/**
 * Alias retained for consumers that build custom polling command lists.
 *
 * @see ReadHoldingRegisters
 */
export type PollingCommand = ReadHoldingRegisters;
