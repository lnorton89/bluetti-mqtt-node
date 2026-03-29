import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  BluetoothDiscovery,
  BluetoothRuntime,
  BluetoothTransport,
  BluetoothTransportFactory,
  DiscoveredBluetoothDevice,
} from "./transport.js";
import type {
  HelperConnectPayload,
  HelperMessage,
  HelperNotificationEvent,
  HelperRequest,
  HelperScanDevice,
} from "./helper-protocol.js";

const DEFAULT_HELPER_COMMAND = [
  "dotnet",
  "run",
  "--project",
  "helper/BluettiMqtt.BluetoothHelper/BluettiMqtt.BluetoothHelper.csproj",
];

export class WindowsHelperClient implements BluetoothDiscovery {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly notificationListeners = new Set<(event: HelperNotification) => void>();
  private readonly ready: Promise<void>;
  private readyResolved = false;

  constructor(command = DEFAULT_HELPER_COMMAND) {
    const [file, ...args] = command;
    if (file === undefined) {
      throw new Error("Helper command cannot be empty");
    }

    this.process = spawn(file, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = createInterface({ input: this.process.stdout });
    this.ready = new Promise<void>((resolve, reject) => {
      lines.on("line", (line) => {
        this.handleLine(line, resolve, reject);
      });
      this.process.once("error", reject);
      this.process.once("exit", (code) => {
        const error = new Error(`Windows BLE helper exited with code ${code ?? -1}`);
        if (!this.readyResolved) {
          reject(error);
        }
        for (const pending of this.pending.values()) {
          pending.reject(error);
        }
        this.pending.clear();
      });
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  async discover(): Promise<readonly DiscoveredBluetoothDevice[]> {
    return this.scan();
  }

  async scan(timeoutMs = 5_000): Promise<readonly HelperScanDevice[]> {
    const payload = await this.request("scan", { timeoutMs });
    const devices = payload?.devices;
    if (!Array.isArray(devices)) {
      return [];
    }

    return devices.flatMap((device) => (isHelperScanDevice(device) ? [device] : []));
  }

  async connect(address: string): Promise<HelperConnectPayload> {
    const payload = await this.request("connect", { address });
    if (!isHelperConnectPayload(payload)) {
      throw new Error("Helper returned an invalid connect payload");
    }
    return payload;
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.request("disconnect", { sessionId });
  }

  async readCharacteristic(sessionId: string, uuid: string): Promise<Uint8Array> {
    const payload = await this.request("readCharacteristic", { sessionId, uuid });
    const dataBase64 = payload?.dataBase64;
    if (typeof dataBase64 !== "string") {
      throw new Error("Helper returned an invalid readCharacteristic payload");
    }
    return new Uint8Array(Buffer.from(dataBase64, "base64"));
  }

  async writeCharacteristic(
    sessionId: string,
    uuid: string,
    data: Uint8Array,
    withoutResponse = false,
  ): Promise<void> {
    await this.request("writeCharacteristic", {
      sessionId,
      uuid,
      dataBase64: Buffer.from(data).toString("base64"),
      withoutResponse,
    });
  }

  async subscribe(sessionId: string, uuid: string): Promise<void> {
    await this.request("subscribe", { sessionId, uuid });
  }

  onNotification(listener: (event: HelperNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  createRuntime(): BluetoothRuntime {
    return createWindowsHelperRuntime(this);
  }

  dispose(): void {
    this.process.kill();
  }

  private async request(command: string, argumentsObject?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    await this.waitUntilReady();

    const id = randomUUID();
    const request: HelperRequest = { id, command };
    if (argumentsObject !== undefined) {
      (request as HelperRequest & { arguments: Record<string, unknown> }).arguments = argumentsObject;
    }

    const response = new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.process.stdin.write(`${JSON.stringify(request)}\n`);
    return response;
  }

  private handleLine(line: string, onReady: () => void, onReadyError: (reason?: unknown) => void): void {
    let message: HelperMessage;
    try {
      message = JSON.parse(line) as HelperMessage;
    } catch (error) {
      if (!this.readyResolved) {
        onReadyError(error);
      }
      return;
    }

    if (message.type === "event") {
      if (message.name === "ready") {
        this.readyResolved = true;
        onReady();
        return;
      }

      if (message.name === "notification" && isHelperNotificationEvent(message)) {
        const payload = message.payload;
        if (payload !== undefined) {
          const event: HelperNotification = {
            sessionId: payload.sessionId,
            uuid: payload.uuid,
            data: new Uint8Array(Buffer.from(payload.dataBase64, "base64")),
          };
          for (const listener of this.notificationListeners) {
            listener(event);
          }
        }
      }
      return;
    }

    if (message.id === undefined) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (message.type === "response") {
      pending.resolve(message.payload);
    } else {
      pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    }
  }
}

export function createWindowsHelperRuntime(client = new WindowsHelperClient()): BluetoothRuntime {
  return {
    discovery: client,
    transportFactory: new WindowsHelperTransportFactory(client),
  };
}

class WindowsHelperTransportFactory implements BluetoothTransportFactory {
  constructor(private readonly client: WindowsHelperClient) {}

  create(): BluetoothTransport {
    return new WindowsHelperTransport(this.client);
  }
}

class WindowsHelperTransport implements BluetoothTransport {
  private sessionId: string | null = null;
  private unsubscribeNotification: (() => void) | null = null;
  private readonly subscribers = new Map<string, (data: Uint8Array) => void>();

  constructor(private readonly client: WindowsHelperClient) {}

  async connect(address: string): Promise<void> {
    const connection = await this.client.connect(address);
    this.sessionId = connection.sessionId;
    this.unsubscribeNotification = this.client.onNotification((event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const callback = this.subscribers.get(normalizeUuid(event.uuid));
      callback?.(event.data);
    });
  }

  async disconnect(): Promise<void> {
    if (this.sessionId !== null) {
      await this.client.disconnect(this.sessionId);
      this.sessionId = null;
    }

    this.unsubscribeNotification?.();
    this.unsubscribeNotification = null;
    this.subscribers.clear();
  }

  async readCharacteristic(uuid: string): Promise<Uint8Array> {
    return this.client.readCharacteristic(this.requireSessionId(), uuid);
  }

  async writeCharacteristic(uuid: string, data: Uint8Array): Promise<void> {
    await this.client.writeCharacteristic(this.requireSessionId(), uuid, data);
  }

  async subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void> {
    const normalizedUuid = normalizeUuid(uuid);
    this.subscribers.set(normalizedUuid, onData);
    await this.client.subscribe(this.requireSessionId(), uuid);
  }

  private requireSessionId(): string {
    if (this.sessionId === null) {
      throw new Error("Helper transport is not connected");
    }
    return this.sessionId;
  }
}

interface PendingRequest {
  resolve: (value: Record<string, unknown> | undefined) => void;
  reject: (reason?: unknown) => void;
}

interface HelperNotification {
  readonly sessionId: string;
  readonly uuid: string;
  readonly data: Uint8Array;
}

function isHelperScanDevice(value: unknown): value is HelperScanDevice {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.address === "string" && typeof candidate.name === "string";
}

function isHelperConnectPayload(value: unknown): value is HelperConnectPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.sessionId === "string"
    && typeof candidate.address === "string"
    && typeof candidate.name === "string";
}

function isHelperNotificationEvent(message: HelperMessage): message is HelperNotificationEvent {
  return message.type === "event" && message.name === "notification";
}

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase();
}
