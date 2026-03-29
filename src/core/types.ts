export type ParsedValue =
  | boolean
  | number
  | string
  | bigint
  | readonly number[]
  | DeviceEnumValue;

export interface DeviceEnumValue {
  readonly name: string;
  readonly value: number;
}

export type ParsedFieldMap = Record<string, ParsedValue>;

export interface WritableRange {
  readonly start: number;
  readonly endExclusive: number;
}

export function isAddressWritable(address: number, ranges: readonly WritableRange[]): boolean {
  return ranges.some((range) => address >= range.start && address < range.endExclusive);
}
