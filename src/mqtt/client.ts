import { connectAsync, type MqttClient as RawMqttClient } from "mqtt";
import { ReadHoldingRegisters, type DeviceCommand } from "../core/commands.js";
import type { EventBus, ParserMessage, CommandMessage } from "../core/event-bus.js";
import { ConsoleLogger, type Logger } from "../core/logger.js";
import type { DeviceEnumValue } from "../core/types.js";
import type { BluettiDevice } from "../devices/device.js";

const COMMAND_TOPIC = /^bluetti\/command\/([A-Z0-9]+)-(\d+)\/([a-z0-9_]+)$/i;

export interface PublishedMqttMessage {
  readonly topic: string;
  readonly payload: string;
  readonly retain?: boolean;
}

export interface ReceivedMqttMessage {
  readonly topic: string;
  readonly payload: Uint8Array;
}

export interface MqttClient {
  publish(message: PublishedMqttMessage): Promise<void>;
  subscribe(topic: string, onMessage: (message: ReceivedMqttMessage) => Promise<void> | void): Promise<void>;
}

export interface BluettiMqttClientOptions {
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
}

export interface RawMqttClientLike {
  subscribe(topic: string): Promise<unknown> | unknown;
  on(event: "message", listener: (topic: string, payload: Buffer) => void): unknown;
  publish(topic: string, payload: string): Promise<unknown> | unknown;
  endAsync(): Promise<unknown>;
}

export type MqttConnector = (
  url: string,
  options: { username?: string; password?: string },
) => Promise<RawMqttClientLike>;

export class BluettiMqttBridge {
  private readonly devices = new Map<string, BluettiDevice>();
  private rawClient: RawMqttClientLike | null = null;

  constructor(
    private readonly bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>,
    private readonly options: BluettiMqttClientOptions,
    private readonly connector: MqttConnector = defaultMqttConnector,
    private readonly logger: Logger = new ConsoleLogger("info"),
  ) {}

  async run(): Promise<void> {
    const connectOptions: { username?: string; password?: string } = {};
    if (this.options.username !== undefined) {
      connectOptions.username = this.options.username;
    }
    if (this.options.password !== undefined) {
      connectOptions.password = this.options.password;
    }

    this.rawClient = await this.connector(this.options.url, connectOptions);
    this.logger.info("Connected to MQTT broker", { url: this.options.url });

    this.bus.addParserListener(async (message) => {
      await this.handleParserMessage(message);
    });
    this.bus.addCommandListener(async (_message) => {
      // The bus fan-out is used for dispatch. The MQTT bridge only publishes incoming parser messages.
    });

    await this.rawClient.subscribe("bluetti/command/#");
    this.logger.info("Subscribed to MQTT command topics", { topic: "bluetti/command/#" });
    this.rawClient.on("message", (topic, payload) => {
      void this.handleIncomingCommand(topic, new Uint8Array(payload)).catch((error: unknown) => {
        // Invalid command payloads and unsupported setters should not crash the long-running bridge.
        this.logger.warn("Ignoring invalid MQTT command payload", {
          topic,
          error: stringifyError(error),
        });
      });
    });
  }

  async stop(): Promise<void> {
    if (this.rawClient !== null) {
      await this.rawClient.endAsync();
      this.logger.info("Disconnected from MQTT broker", { url: this.options.url });
      this.rawClient = null;
    }
  }

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

  private requireClient(): RawMqttClientLike {
    if (this.rawClient === null) {
      throw new Error("MQTT bridge is not connected");
    }
    return this.rawClient;
  }
}

export class BasicMqttClient implements MqttClient {
  private readonly callbacks = new Map<string, (message: ReceivedMqttMessage) => Promise<void> | void>();

  constructor(private readonly rawClient: RawMqttClient) {
    this.rawClient.on("message", (topic, payload) => {
      const callback = this.callbacks.get(topic);
      if (!callback) {
        return;
      }
      void callback({ topic, payload: new Uint8Array(payload) });
    });
  }

  async publish(message: PublishedMqttMessage): Promise<void> {
    await this.rawClient.publishAsync(message.topic, message.payload, { retain: message.retain ?? false });
  }

  async subscribe(topic: string, onMessage: (message: ReceivedMqttMessage) => Promise<void> | void): Promise<void> {
    this.callbacks.set(topic, onMessage);
    await this.rawClient.subscribeAsync(topic);
  }
}

async function defaultMqttConnector(
  url: string,
  options: { username?: string; password?: string },
): Promise<RawMqttClientLike> {
  return connectAsync(url, options) as unknown as RawMqttClient;
}

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

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

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

function deviceKey(device: BluettiDevice): string {
  return `${device.type}-${device.serialNumber}`;
}

export type PollingCommand = ReadHoldingRegisters;

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
