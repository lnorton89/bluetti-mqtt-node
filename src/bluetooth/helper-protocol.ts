/**
 * Request line sent from Node to the Windows helper process.
 *
 * Each request is a single JSON object terminated by a newline on the helper's
 * stdin. The `id` field correlates the response.
 *
 * @see HelperResponse
 * @see HelperError
 */
export interface HelperRequest {
  /** Unique request ID used to correlate the response. */
  readonly id?: string;
  /** Command name (e.g. `"scan"`, `"connect"`, `"readCharacteristic"`). */
  readonly command: string;
  /** Command-specific arguments. */
  readonly arguments?: Record<string, unknown>;
}

/**
 * Successful response line correlated by request ID.
 *
 * @see HelperRequest
 */
export interface HelperResponse {
  /** Discriminator identifying this as a successful response. */
  readonly type: "response";
  /** ID matching the originating request. */
  readonly id?: string;
  /** Command-specific response payload. */
  readonly payload?: Record<string, unknown>;
}

/**
 * Failed response line with a stable machine-readable error code.
 *
 * @see HelperRequest
 * @see WindowsHelperClient
 */
export interface HelperError {
  /** Discriminator identifying this as an error response. */
  readonly type: "error";
  /** ID matching the originating request. */
  readonly id?: string;
  /** Structured error details. */
  readonly error: {
    /** Stable error code (e.g. `"command_failed"`). */
    readonly code: string;
    /** Human-readable error message. */
    readonly message: string;
  };
}

/**
 * Unsolicited event line emitted by the helper.
 *
 * Events are not correlated with requests. The `ready` event signals that the
 * helper is initialized; `notification` events carry characteristic data.
 *
 * @see HelperNotificationEvent
 */
export interface HelperEvent {
  /** Discriminator identifying this as an unsolicited event. */
  readonly type: "event";
  /** Event name (e.g. `"ready"`, `"notification"`). */
  readonly name: string;
  /** Event-specific payload. */
  readonly payload?: Record<string, unknown>;
}

/**
 * Any complete line accepted from the helper process.
 *
 * @see HelperResponse
 * @see HelperError
 * @see HelperEvent
 */
export type HelperMessage = HelperResponse | HelperError | HelperEvent;

/**
 * Device advertisement serialized by the native scanner.
 *
 * @see WindowsHelperClient.scan
 */
export interface HelperScanDevice {
  /** Bluetooth MAC address (platform-specific format). */
  readonly address: string;
  /** Advertised device name. */
  readonly name: string;
  /** Received signal strength in dBm, if available. */
  readonly rssi?: number;
}

/**
 * Notification event carrying bytes from a subscribed characteristic.
 *
 * Emitted by the helper when a GATT characteristic that was previously
 * subscribed via the `subscribe` command sends a notification. The payload
 * is base64-encoded to survive JSON transport.
 *
 * @see HelperEvent
 * @see WindowsHelperClient.onNotification
 */
export interface HelperNotificationEvent extends HelperEvent {
  /** Fixed event name for characteristic notifications. */
  readonly name: "notification";
  /** Notification payload containing session, UUID, and base64 data. */
  readonly payload?: {
    /** Helper session ID that owns the subscription. */
    readonly sessionId: string;
    /** Characteristic UUID that produced the notification. */
    readonly uuid: string;
    /** Notification bytes encoded as base64. */
    readonly dataBase64: string;
  };
}

/**
 * Session identity and device metadata returned after connecting.
 *
 * @see WindowsHelperClient.connect
 */
export interface HelperConnectPayload {
  /** Unique session ID assigned by the helper for this GATT connection. */
  readonly sessionId: string;
  /** Bluetooth MAC address that was connected. */
  readonly address: string;
  /** Advertised device name read from the standard name characteristic. */
  readonly name: string;
}
