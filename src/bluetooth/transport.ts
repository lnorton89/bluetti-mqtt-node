export interface DiscoveredBluetoothDevice {
  readonly address: string;
  readonly name: string;
  readonly rssi?: number;
}

export interface BluetoothTransport {
  connect(address: string): Promise<void>;
  disconnect(): Promise<void>;
  readCharacteristic(uuid: string): Promise<Uint8Array>;
  writeCharacteristic(uuid: string, data: Uint8Array): Promise<void>;
  subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void>;
}

export interface BluetoothTransportFactory {
  create(): BluetoothTransport;
}

export interface BluetoothDiscovery {
  discover(): Promise<readonly DiscoveredBluetoothDevice[]>;
}

export interface BluetoothRuntime {
  readonly transportFactory: BluetoothTransportFactory;
  readonly discovery?: BluetoothDiscovery;
}
