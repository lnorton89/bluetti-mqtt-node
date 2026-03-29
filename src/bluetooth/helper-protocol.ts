export interface HelperRequest {
  readonly id?: string;
  readonly command: string;
  readonly arguments?: Record<string, unknown>;
}

export interface HelperResponse {
  readonly type: "response";
  readonly id?: string;
  readonly payload?: Record<string, unknown>;
}

export interface HelperError {
  readonly type: "error";
  readonly id?: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface HelperEvent {
  readonly type: "event";
  readonly name: string;
  readonly payload?: Record<string, unknown>;
}

export type HelperMessage = HelperResponse | HelperError | HelperEvent;

export interface HelperScanDevice {
  readonly address: string;
  readonly name: string;
  readonly rssi?: number;
}

export interface HelperNotificationEvent extends HelperEvent {
  readonly name: "notification";
  readonly payload?: {
    readonly sessionId: string;
    readonly uuid: string;
    readonly dataBase64: string;
  };
}

export interface HelperConnectPayload {
  readonly sessionId: string;
  readonly address: string;
  readonly name: string;
}
