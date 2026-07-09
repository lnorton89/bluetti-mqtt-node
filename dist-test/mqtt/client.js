import { connectAsync } from "mqtt";
import { ConsoleLogger } from "@core/logger.js";
/** Regex matching `bluetti/command/<MODEL>-<SERIAL>/<FIELD>` command topics. */
const COMMAND_TOPIC = /^bluetti\/command\/([A-Z0-9]+)-(\d+)\/([a-z0-9_]+)$/i;
export { BasicMqttClient } from "./basic-client.js";
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
export class BluettiMqttBridge {
    bus;
    options;
    connector;
    logger;
    /** Devices discovered from parser messages, keyed by `MODEL-SERIAL`. */
    devices = new Map();
    /** Connected raw MQTT client, or `null` when not running. */
    rawClient = null;
    /** Disposer for the event bus parser listener, or `null` when not installed. */
    removeParserListener = null;
    /** Registered raw MQTT message listener, or `null` when not installed. */
    messageListener = null;
    /**
     * Creates an MQTT bridge connected to an event bus.
     *
     * @param bus - Event bus carrying parser telemetry and command messages.
     * @param options - MQTT broker connection options.
     * @param connector - Injectable MQTT connector (defaults to `mqtt.connectAsync`).
     * @param logger - Optional logger; defaults to `ConsoleLogger` at `info`.
     */
    constructor(bus, options, connector = defaultMqttConnector, logger = new ConsoleLogger("info")) {
        this.bus = bus;
        this.options = options;
        this.connector = connector;
        this.logger = logger;
    }
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
    async run() {
        if (this.rawClient !== null) {
            throw new Error("MQTT bridge is already running");
        }
        const connectOptions = {};
        if (this.options.username !== undefined) {
            connectOptions.username = this.options.username;
        }
        if (this.options.password !== undefined) {
            connectOptions.password = this.options.password;
        }
        const client = await this.connector(this.options.url, connectOptions);
        this.rawClient = client;
        this.logger.info("Connected to MQTT broker", { url: this.options.url });
        try {
            await client.subscribe("bluetti/command/#");
            this.logger.info("Subscribed to MQTT command topics", { topic: "bluetti/command/#" });
            this.removeParserListener = this.bus.addParserListener(async (message) => {
                await this.handleParserMessage(message);
            });
            this.messageListener = (topic, payload) => {
                void this.handleIncomingCommand(topic, new Uint8Array(payload)).catch((error) => {
                    // Invalid command payloads and unsupported setters should not crash the long-running bridge.
                    this.logger.warn("Ignoring invalid MQTT command payload", {
                        topic,
                        error: stringifyError(error),
                    });
                });
            };
            client.on("message", this.messageListener);
        }
        catch (error) {
            try {
                await this.cleanupClient(client);
            }
            catch {
                // Preserve the startup failure; local listener state is already cleared.
            }
            throw error;
        }
    }
    /**
     * Removes bus listeners and closes the MQTT connection.
     *
     * @remarks
     * JavaScript callbacks are released before awaiting network shutdown so a
     * failing `endAsync` cannot leave the bridge logically connected. Cleanup
     * failures are collected into an {@link AggregateError}.
     */
    async stop() {
        const client = this.rawClient;
        if (client === null)
            return;
        await this.cleanupClient(client);
        this.logger.info("Disconnected from MQTT broker", { url: this.options.url });
    }
    /**
     * Publishes parsed telemetry fields to individual state topics and a `_raw` snapshot.
     *
     * @param message - Parser message containing the device and decoded fields.
     */
    async handleParserMessage(message) {
        const client = this.requireClient();
        this.devices.set(deviceKey(message.device), message.device);
        for (const [name, value] of Object.entries(message.parsed)) {
            await client.publish(`bluetti/state/${message.device.type}-${message.device.serialNumber}/${name}`, serializeValue(value));
        }
        await client.publish(`bluetti/state/${message.device.type}-${message.device.serialNumber}/_raw`, JSON.stringify(normalizeRecord(message.parsed)));
    }
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
    async handleIncomingCommand(topic, payload) {
        const match = COMMAND_TOPIC.exec(topic);
        if (match === null) {
            return;
        }
        const [, model, serialNumber, fieldName] = match;
        if (model === undefined || serialNumber === undefined || fieldName === undefined) {
            return;
        }
        const device = this.devices.get(`${model}-${serialNumber}`);
        if (device === undefined || !device.hasFieldSetter(fieldName)) {
            return;
        }
        const decoded = Buffer.from(payload).toString("utf8").trim();
        const value = parseCommandValue(decoded);
        const command = device.buildSetterCommand(fieldName, value);
        this.logger.info("Dispatching MQTT command", {
            topic,
            device: deviceKey(device),
            fieldName,
            value,
        });
        await this.bus.publishCommandMessage({ device, command });
    }
    /**
     * Returns the connected raw client or throws when not connected.
     *
     * @returns The active raw MQTT client.
     * @throws {Error} When the bridge is not connected.
     */
    requireClient() {
        if (this.rawClient === null) {
            throw new Error("MQTT bridge is not connected");
        }
        return this.rawClient;
    }
    /**
     * Releases all JavaScript callbacks, then closes the raw MQTT connection.
     *
     * @param client - Raw client to clean up.
     * @throws {AggregateError} When one or more cleanup steps fail.
     */
    async cleanupClient(client) {
        // Release JavaScript callbacks before awaiting network shutdown so a
        // failing endAsync cannot leave the bridge logically connected.
        const failures = [];
        this.rawClient = null;
        this.removeParserListener?.();
        this.removeParserListener = null;
        if (this.messageListener !== null) {
            try {
                client.off("message", this.messageListener);
            }
            catch (error) {
                failures.push(error);
            }
            this.messageListener = null;
        }
        try {
            await client.endAsync();
        }
        catch (error) {
            failures.push(error);
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, "Failed to clean up MQTT client");
        }
    }
}
/**
 * Default MQTT connector using `mqtt.connectAsync`.
 *
 * @param url - Broker URL.
 * @param options - Optional username/password.
 * @returns A connected raw MQTT client.
 */
async function defaultMqttConnector(url, options) {
    return connectAsync(url, options);
}
/**
 * Converts a parsed field value to its MQTT string representation.
 *
 * @param value - Value to serialize (boolean, bigint, array, enum, or number/string).
 * @returns `"ON"`/`"OFF"` for booleans, string for bigints, JSON for arrays,
 *   enum name for enum values, or `String(value)` otherwise.
 */
function serializeValue(value) {
    if (typeof value === "boolean") {
        return value ? "ON" : "OFF";
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }
    if (value && typeof value === "object" && "name" in value && "value" in value) {
        const enumValue = value;
        return enumValue.name;
    }
    return String(value);
}
/**
 * Parses an MQTT command payload string into a typed value.
 *
 * @param payload - Raw string payload (`"ON"`, `"OFF"`, numeric, or string).
 * @returns `true`/`false` for ON/OFF, `number` for integers, or the raw string.
 */
function parseCommandValue(payload) {
    if (payload === "ON") {
        return true;
    }
    if (payload === "OFF") {
        return false;
    }
    if (/^-?\d+$/.test(payload)) {
        return Number(payload);
    }
    return payload;
}
/**
 * Recursively normalizes a parsed field map for JSON publication.
 *
 * @param record - Raw parsed field map.
 * @returns A JSON-safe object where bigints become strings and enums become names.
 */
function normalizeRecord(record) {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]));
}
/**
 * Recursively normalizes a single value for JSON publication.
 *
 * @param value - Value that may contain `bigint`, enums, or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string` and
 *   enum values become their name.
 */
function normalizeValue(value) {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
    }
    if (value && typeof value === "object") {
        if ("name" in value && "value" in value) {
            const enumValue = value;
            return enumValue.name;
        }
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]));
    }
    return value;
}
/**
 * Returns the `MODEL-SERIAL` composite key for a device.
 *
 * @param device - Device to key.
 * @returns `${device.type}-${device.serialNumber}`.
 */
function deviceKey(device) {
    return `${device.type}-${device.serialNumber}`;
}
/**
 * Extracts a display string from an unknown error value.
 *
 * @param error - Value to stringify.
 * @returns `error.message` for `Error` instances, otherwise `String(error)`.
 */
function stringifyError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
