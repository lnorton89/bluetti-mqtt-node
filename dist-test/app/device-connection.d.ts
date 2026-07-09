import { MultiDeviceManager } from "@bluetooth/manager.js";
import { type Logger } from "@core/logger.js";
/**
 * Retries device connection on recoverable BLE startup errors.
 *
 * @returns `true` when connection succeeds, `false` when stopped.
 */
export declare function connectAllWithRecovery(connectAll: () => Promise<void>, isStopRequested: () => boolean, runOnce: boolean, logger: Logger, sleep: (ms: number) => Promise<void>): Promise<boolean>;
/**
 * Repeatedly attempts to reconnect a lost device until success or stop.
 *
 * @returns `true` when reconnection succeeds, `false` when stopped.
 */
export declare function recoverDeviceConnection(address: string, manager: MultiDeviceManager, isStopRequested: () => boolean, logger: Logger, sleep: (ms: number) => Promise<void>): Promise<boolean>;
