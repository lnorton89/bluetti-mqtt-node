import type { BluetoothRuntime } from "./transport.js";

/**
 * Creates a platform-appropriate Bluetooth runtime.
 *
 * @remarks
 * Detects the current operating system and creates the matching runtime:
 *
 * - **Windows**: Spawns the .NET helper process for native BLE access.
 * - **Linux**: Talks directly to BlueZ over D-Bus.
 * - **Other platforms**: Throws an error.
 *
 * The returned runtime provides a transport factory and optional discovery
 * adapter, both of which are platform-specific but conform to the same
 * interfaces.
 *
 * @example
 * ```ts
 * const runtime = await createRuntime();
 * const transport = runtime.transportFactory.create();
 * ```
 *
 * @see BluetoothRuntime
 * @see WindowsHelperClient
 * @see createLinuxRuntime
 */
export async function createRuntime(): Promise<BluetoothRuntime> {
	switch (process.platform) {
		case "win32": {
			const { createWindowsHelperRuntime } = await import("./helper-client.js");
			return createWindowsHelperRuntime();
		}

		case "linux": {
			const { createLinuxRuntime } = await import("./bluez-transport.js");
			return createLinuxRuntime();
		}

		default:
			throw new Error(
				`Unsupported platform: ${process.platform}. Bluetooth is supported on Windows and Linux.`,
			);
	}
}
