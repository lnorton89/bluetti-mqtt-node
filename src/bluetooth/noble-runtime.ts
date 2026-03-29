import type {
  BluetoothDiscovery,
  BluetoothRuntime,
  BluetoothTransport,
  BluetoothTransportFactory,
  DiscoveredBluetoothDevice,
} from "./transport.js";

type NobleModule = {
  default?: NobleApi;
} & NobleApi;

interface NobleApi {
  state?: string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  startScanningAsync(serviceUuids?: readonly string[], allowDuplicates?: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
}

interface NoblePeripheral {
  address: string;
  advertisement?: {
    localName?: string;
  };
  rssi?: number;
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync(
    serviceUuids: readonly string[],
    characteristicUuids: readonly string[],
  ): Promise<{ characteristics: NobleCharacteristic[] }>;
}

interface NobleCharacteristic {
  uuid: string;
  readAsync(): Promise<Buffer>;
  writeAsync(data: Buffer, withoutResponse?: boolean): Promise<void>;
  subscribeAsync(): Promise<void>;
  on(event: "data", listener: (data: Buffer) => void): void;
}

export async function createNobleRuntime(): Promise<BluetoothRuntime> {
  const noble = await loadNobleModule();
  const adapter = new NobleAdapter(noble);
  return {
    transportFactory: adapter,
    discovery: adapter,
  };
}

class NobleAdapter implements BluetoothTransportFactory, BluetoothDiscovery {
  constructor(private readonly noble: NobleApi) {}

  create(): BluetoothTransport {
    return new NobleTransport(this.noble);
  }

  async discover(): Promise<readonly DiscoveredBluetoothDevice[]> {
    await waitForPoweredOn(this.noble);

    const devices = new Map<string, DiscoveredBluetoothDevice>();
    const onDiscover = (peripheral: unknown) => {
      const device = peripheral as NoblePeripheral;
      const name = device.advertisement?.localName;
      if (!device.address || !name) {
        return;
      }

      const discovered: DiscoveredBluetoothDevice = device.rssi === undefined
        ? {
            address: device.address.toUpperCase(),
            name,
          }
        : {
            address: device.address.toUpperCase(),
            name,
            rssi: device.rssi,
          };

      devices.set(device.address.toUpperCase(), discovered);
    };

    this.noble.on("discover", onDiscover);
    try {
      await this.noble.startScanningAsync([], true);
      await sleep(5_000);
      await this.noble.stopScanningAsync();
    } finally {
      this.noble.removeListener("discover", onDiscover);
    }

    return [...devices.values()];
  }
}

class NobleTransport implements BluetoothTransport {
  private peripheral: NoblePeripheral | null = null;
  private readonly characteristics = new Map<string, NobleCharacteristic>();

  constructor(private readonly noble: NobleApi) {}

  async connect(address: string): Promise<void> {
    await waitForPoweredOn(this.noble);
    const peripheral = await discoverPeripheralByAddress(this.noble, address);
    await peripheral.connectAsync();
    this.peripheral = peripheral;
  }

  async disconnect(): Promise<void> {
    if (this.peripheral !== null) {
      await this.peripheral.disconnectAsync();
      this.peripheral = null;
      this.characteristics.clear();
    }
  }

  async readCharacteristic(uuid: string): Promise<Uint8Array> {
    const characteristic = await this.getCharacteristic(uuid);
    return new Uint8Array(await characteristic.readAsync());
  }

  async writeCharacteristic(uuid: string, data: Uint8Array): Promise<void> {
    const characteristic = await this.getCharacteristic(uuid);
    await characteristic.writeAsync(Buffer.from(data), false);
  }

  async subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void> {
    const characteristic = await this.getCharacteristic(uuid);
    characteristic.on("data", (data) => onData(new Uint8Array(data)));
    await characteristic.subscribeAsync();
  }

  private async getCharacteristic(uuid: string): Promise<NobleCharacteristic> {
    const normalizedUuid = normalizeUuid(uuid);
    const existing = this.characteristics.get(normalizedUuid);
    if (existing !== undefined) {
      return existing;
    }

    if (this.peripheral === null) {
      throw new Error("Transport is not connected");
    }

    const discovered = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync([], [normalizedUuid]);
    const characteristic = discovered.characteristics[0];
    if (characteristic === undefined) {
      throw new Error(`Characteristic ${uuid} was not found`);
    }

    this.characteristics.set(normalizedUuid, characteristic);
    return characteristic;
  }
}

async function discoverPeripheralByAddress(noble: NobleApi, address: string): Promise<NoblePeripheral> {
  const normalizedAddress = address.toUpperCase();
  await noble.startScanningAsync([], true);

  try {
    return await new Promise<NoblePeripheral>((resolve, reject) => {
      const timeout = setTimeout(() => {
        noble.removeListener("discover", onDiscover);
        reject(new Error(`Timed out discovering peripheral ${address}`));
      }, 10_000);

      const onDiscover = (candidate: unknown) => {
        const peripheral = candidate as NoblePeripheral;
        if (peripheral.address.toUpperCase() !== normalizedAddress) {
          return;
        }

        clearTimeout(timeout);
        noble.removeListener("discover", onDiscover);
        void noble.stopScanningAsync();
        resolve(peripheral);
      };

      noble.on("discover", onDiscover);
    });
  } catch (error) {
    await noble.stopScanningAsync();
    throw error;
  }
}

async function waitForPoweredOn(noble: NobleApi): Promise<void> {
  if (noble.state === "poweredOn") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      noble.removeListener("stateChange", onStateChange);
      reject(new Error("Timed out waiting for Bluetooth adapter to become powered on"));
    }, 10_000);

    const onStateChange = (state: unknown) => {
      if (state === "poweredOn") {
        clearTimeout(timeout);
        noble.removeListener("stateChange", onStateChange);
        resolve();
      }
    };

    noble.on("stateChange", onStateChange);
  });
}

async function loadNobleModule(): Promise<NobleApi> {
  try {
    const nobleModule = (await importOptionalModule("@abandonware/noble")) as NobleModule;
    return nobleModule.default ?? nobleModule;
  } catch (error) {
    throw new Error(
      `Failed to load @abandonware/noble. Install/build it successfully before using the BLE runtime. ${stringifyError(
        error,
      )}`,
    );
  }
}

async function importOptionalModule(specifier: string): Promise<unknown> {
  const importer = new Function("specifier", "return import(specifier);") as (
    moduleSpecifier: string,
  ) => Promise<unknown>;
  return importer(specifier);
}

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
