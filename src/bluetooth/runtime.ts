import {
	createWindowsHelperRuntime,
	WindowsHelperClient,
} from "./helper-client.js";
import {
	createSimulatedFleet,
	createSimulatedRuntime,
} from "./simulated-device.js";
import type { BluetoothRuntime } from "./transport.js";

/** Default simulated fleet when mock mode is enabled without explicit models. */
const DEFAULT_MOCK_MODELS: readonly string[] = ["AC500"];

/**
 * Options controlling {@link createPlatformRuntime} backend selection.
 *
 * @see createPlatformRuntime
 */
export interface PlatformRuntimeOptions {
	/** When `true`, back the runtime with simulated devices instead of native BLE. */
	readonly mock?: boolean;
	/** Model families for the simulated fleet (default `["AC500"]`). */
	readonly mockDevices?: readonly string[];
}

/**
 * A selected Bluetooth runtime plus the disposer for its native resources.
 *
 * @see createPlatformRuntime
 */
export interface RuntimeHandle {
	/** The platform (or simulated) Bluetooth runtime. */
	readonly runtime: BluetoothRuntime;
	/** Releases native resources behind the runtime (no-op for mock). */
	dispose(): void;
}

/**
 * Selects the Bluetooth backend for the current platform or mock mode.
 *
 * @param options - Mock-mode selection and simulated fleet configuration.
 * @returns The runtime and its disposer.
 * @throws {Error} On platforms without a native backend when mock mode is
 *   not requested.
 *
 * @remarks
 * Backend selection order:
 * 1. `mock: true` — simulated devices via {@link createSimulatedRuntime};
 *    works on every platform with no native dependencies.
 * 2. `win32` — the .NET helper process via {@link createWindowsHelperRuntime}.
 * 3. Anything else — throws. A native Linux/macOS backend (planned on
 *    `@stoprocent/noble`) will plug in here.
 *
 * @example
 * ```ts
 * const handle = createPlatformRuntime({ mock: true });
 * try {
 *   const devices = await handle.runtime.discovery?.discover();
 * } finally {
 *   handle.dispose();
 * }
 * ```
 */
export function createPlatformRuntime(
	options: PlatformRuntimeOptions = {},
): RuntimeHandle {
	if (options.mock === true) {
		const models = options.mockDevices ?? DEFAULT_MOCK_MODELS;
		return {
			runtime: createSimulatedRuntime(createSimulatedFleet(models)),
			dispose: () => {},
		};
	}

	if (process.platform === "win32") {
		const client = new WindowsHelperClient();
		return {
			runtime: createWindowsHelperRuntime(client),
			dispose: () => {
				client.dispose();
			},
		};
	}

	throw new Error(
		`Native Bluetooth support is not implemented for platform '${process.platform}' yet. ` +
			"Run with --mock to use simulated devices, or follow the Linux/macOS backend " +
			"progress (planned on @stoprocent/noble) in the project README.",
	);
}
