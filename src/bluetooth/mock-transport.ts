import type { BluetoothTransport, BluetoothTransportFactory } from "./transport.js";

export interface MockBluetoothOptions {
  readonly characteristics?: Readonly<Record<string, Uint8Array>>;
  readonly writes?: Uint8Array[];
}

export class MockBluetoothTransport implements BluetoothTransport {
  private readonly characteristics = new Map<string, Uint8Array>();
  private readonly subscribers = new Map<string, (data: Uint8Array) => void>();
  private readonly writes: Uint8Array[];
  connectedAddress: string | null = null;

  constructor(options: MockBluetoothOptions = {}) {
    for (const [uuid, value] of Object.entries(options.characteristics ?? {})) {
      this.characteristics.set(normalizeUuid(uuid), value.slice());
    }
    this.writes = options.writes ?? [];
  }

  async connect(address: string): Promise<void> {
    this.connectedAddress = address;
  }

  async disconnect(): Promise<void> {
    this.connectedAddress = null;
  }

  async readCharacteristic(uuid: string): Promise<Uint8Array> {
    const value = this.characteristics.get(normalizeUuid(uuid));
    if (value === undefined) {
      throw new Error(`No mock characteristic value registered for ${uuid}`);
    }
    return value.slice();
  }

  async writeCharacteristic(_uuid: string, data: Uint8Array): Promise<void> {
    this.writes.push(data.slice());
  }

  async subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void> {
    this.subscribers.set(normalizeUuid(uuid), onData);
  }

  emit(uuid: string, data: Uint8Array): void {
    const subscriber = this.subscribers.get(normalizeUuid(uuid));
    if (subscriber === undefined) {
      throw new Error(`No mock subscriber registered for ${uuid}`);
    }
    subscriber(data.slice());
  }
}

export class MockBluetoothTransportFactory implements BluetoothTransportFactory {
  constructor(private readonly transport: MockBluetoothTransport) {}

  create(): BluetoothTransport {
    return this.transport;
  }
}

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}
