import { connectAsync, type MqttClient as RawMqttClient } from "mqtt";
import { ReadHoldingRegisters, type DeviceCommand } from "@core/commands.js";
import type { EventBus, ParserMessage, CommandMessage } from "@core/event-bus.js";
import { ConsoleLogger, type Logger } from "@core/logger.js";
import type { DeviceEnumValue } from "@core/types.js";
import type { BluettiDevice } from "@devices/device.js";

/** Regex matching `bluetti/command/<MODEL>-<SERIAL>/<FIELD>` command topics. */
const COMMAND_TOPIC = /^bluetti\/command\/([A-Z0-9]+)-(\d+)\/([a-z0-9_]+)$/i;

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
export type MqttConnector = (
  url: string,
  options: { username?: string; password?: string },
) => Promise<RawMqttClientLike>;

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
  /** Devices discovered from parser messages, keyed by `MODEL-SERIAL`. */
  private readonly devices = new Map<string, BluettiDevice>();
  /** Connected raw MQTT client, or `null` when not running. */
  private rawClient: RawMqttClientLike | null = null;
  /** Disposer for the event bus parser listener, or `null` when not installed. */
  private removeParserListener: (() => void) | null = null;
  /** Registered raw MQTT message listener, or `null` when not installed. */
  private messageListener: ((topic: string, payload: Buffer) => void) | null = null;

  /**
   * Creates an MQTT bridge connected to an event bus.
   *
   * @param bus - Event bus carrying parser telemetry and command messages.
   * @param options - MQTT broker connection options.
   * @param connector - Injectable MQTT connector (defaults to `mqtt.connectAsync`).
   * @param logger - Optional logger; defaults to `ConsoleLogger` at `info`.
   */
  constructor(
    private readonly bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>,
    private readonly options: BluettiMqttClientOptions,
    private readonly connector: MqttConnector = defaultMqttConnector,
    private readonly logger: Logger = new ConsoleLogger("info"),
  ) {}

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
  async run(): Promise<void> {
    if (this.rawClient !== null) {
      throw new Error("MQTT bridge is already running");
    }

    const connectOptions: { username?: string; password?: string } = {};
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
        void this.handleIncomingCommand(topic, new Uint8Array(payload)).catch((error: unknown) => {
          // Invalid command payloads and unsupported setters should not crash the long-running bridge.
          this.logger.warn("Ignoring invalid MQTT command payload", {
            topic,
            error: stringifyError(error),
          });
        });
      };
      client.on("message", this.messageListener);
    } catch (error) {
      try {
        await this.cleanupClient(client);
      } catch {
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
  async stop(): Promise<void> {
    const client = this.rawClient;
    if (client === null) return;

    await this.cleanupClient(client);
    this.logger.info("Disconnected from MQTT broker", { url: this.options.url });
  }

  /**
   * Publishes parsed telemetry fields to individual state topics and a `_raw` snapshot.
   *
   * @param message - Parser message containing the device and decoded fields.
   */
  private async handleParserMessage(message: ParserMessage<BluettiDevice>): Promise<void> {
    const client = this.requireClient();
    this.devices.set(deviceKey(message.device), message.device);

    for (const [name, value] of Object.entries(message.parsed)) {
      await client.publish(`bluetti/state/${message.device.type}-${message.device.serialNumber}/${name}`, serializeValue(value));
    }

    await client.publish(
      `bluetti/state/${message.device.type}-${message.device.serialNumber}/_raw`,
      JSON.stringify(normalizeRecord(message.parsed)),
    );
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
  private async handleIncomingCommand(topic: string, payload: Uint8Array): Promise<void> {
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
    await this.bus.publishCommandMessage({ device, command } as CommandMessage<BluettiDevice, DeviceCommand>);
  }

  /**
   * Returns the connected raw client or throws when not connected.
   *
   * @returns The active raw MQTT client.
   * @throws {Error} When the bridge is not connected.
   */
  private requireClient(): RawMqttClientLike {
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
  private async cleanupClient(client: RawMqttClientLike): Promise<void> {
    // Release JavaScript callbacks before awaiting network shutdown so a
    // failing endAsync cannot leave the bridge logically connected.
    const failures: unknown[] = [];
    this.rawClient = null;
    this.removeParserListener?.();
    this.removeParserListener = null;
    if (this.messageListener !== null) {
      try {
        client.off("message", this.messageListener);
      } catch (error) {
        failures.push(error);
      }
      this.messageListener = null;
    }
    try {
      await client.endAsync();
    } catch (error) {
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
async function defaultMqttConnector(
  url: string,
  options: { username?: string; password?: string },
): Promise<RawMqttClientLike> {
  return connectAsync(url, options) as unknown as RawMqttClient;
}

/**
 * Converts a parsed field value to its MQTT string representation.
 *
 * @param value - Value to serialize (boolean, bigint, array, enum, or number/string).
 * @returns `"ON"`/`"OFF"` for booleans, string for bigints, JSON for arrays,
 *   enum name for enum values, or `String(value)` otherwise.
 */
function serializeValue(value: unknown): string {
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
    const enumValue = value as DeviceEnumValue;
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
function parseCommandValue(payload: string): boolean | number | string {
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
function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

/**
 * Recursively normalizes a single value for JSON publication.
 *
 * @param value - Value that may contain `bigint`, enums, or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string` and
 *   enum values become their name.
 */
function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === "object") {
    if ("name" in value && "value" in value) {
      const enumValue = value as DeviceEnumValue;
      return enumValue.name;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeValue(entry)]),
    );
  }
  return value;
}

/**
 * Returns the `MODEL-SERIAL` composite key for a device.
 *
 * @param device - Device to key.
 * @returns `${device.type}-${device.serialNumber}`.
 */
function deviceKey(device: BluettiDevice): string {
  return `${device.type}-${device.serialNumber}`;
}

/**
 * Alias retained for consumers that build custom polling command lists.
 *
 * @see ReadHoldingRegisters
 */
export type PollingCommand = ReadHoldingRegisters;

/**
 * Extracts a display string from an unknown error value.
 *
 * @param error - Value to stringify.
 * @returns `error.message` for `Error` instances, otherwise `String(error)`.
 */
function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
