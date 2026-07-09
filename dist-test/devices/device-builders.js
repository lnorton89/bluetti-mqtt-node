import { AutoSleepMode, BatteryState, ChargingMode, EcoShutdown, LedMode, MachineAddress, OutputMode, UpsMode, } from "./enums.js";
import { BoolField, EnumField, SerialNumberField, StringField, UintField, VersionField, } from "./field.js";
import { DeviceStruct } from "./struct.js";
// ---------------------------------------------------------------------------
// Shared field groups
// ---------------------------------------------------------------------------
const CORE = [
    new StringField("device_type", 10, 6),
    new SerialNumberField("serial_number", 17),
    new VersionField("arm_version", 23),
    new VersionField("dsp_version", 25),
    new UintField("dc_input_power", 36),
    new UintField("ac_input_power", 37),
    new UintField("ac_output_power", 38),
    new UintField("dc_output_power", 39),
    new UintField("total_battery_percent", 43),
    new BoolField("ac_output_on", 48),
    new BoolField("dc_output_on", 49),
    new UintField("pack_num_max", 91),
];
const CONTROL = [
    new EnumField("ups_mode", 3001, UpsMode),
    new BoolField("split_phase_on", 3004),
    new EnumField("split_phase_machine_mode", 3005, MachineAddress),
    new UintField("pack_num", 3006),
    new BoolField("ac_output_on", 3007),
    new BoolField("dc_output_on", 3008),
    new BoolField("grid_charge_on", 3011),
    new BoolField("time_control_on", 3013),
    new UintField("battery_range_start", 3015),
    new UintField("battery_range_end", 3016),
    new BoolField("bluetooth_connected", 3036),
    new EnumField("auto_sleep_mode", 3061, AutoSleepMode),
];
// ---------------------------------------------------------------------------
// Per-device struct builders
// ---------------------------------------------------------------------------
function buildAc200mStruct() {
    return new DeviceStruct()
        .addMany(CORE)
        .addDecimalField("power_generation", 41, 1)
        .addEnumField("ac_output_mode", 70, OutputMode)
        .addUintField("internal_ac_voltage", 71)
        .addDecimalField("internal_current_one", 72, 1)
        .addUintField("internal_power_one", 73)
        .addDecimalField("internal_ac_frequency", 74, 1)
        .addUintField("internal_dc_input_voltage", 86)
        .addDecimalField("internal_dc_input_power", 87, 1)
        .addDecimalField("internal_dc_input_current", 88, 2)
        .addDecimalField("total_battery_voltage", 92, 2)
        .addUintField("pack_num", 96)
        .addDecimalField("pack_voltage", 98, 2)
        .addUintField("pack_battery_percent", 99)
        .addDecimalArrayField("cell_voltages", 105, 16, 2)
        .addUintField("pack_num", 3006)
        .addBoolField("ac_output_on", 3007)
        .addBoolField("dc_output_on", 3008)
        .addBoolField("power_off", 3060)
        .addEnumField("auto_sleep_mode", 3061, AutoSleepMode);
}
function buildAc300Struct() {
    return new DeviceStruct()
        .addMany(CORE)
        .addDecimalField("power_generation", 41, 1)
        .addEnumField("ac_output_mode", 70, OutputMode)
        .addDecimalField("internal_ac_voltage", 71, 1)
        .addDecimalField("internal_current_one", 72, 1)
        .addUintField("internal_power_one", 73)
        .addDecimalField("internal_ac_frequency", 74, 2)
        .addDecimalField("internal_current_two", 75, 1)
        .addUintField("internal_power_two", 76)
        .addDecimalField("ac_input_voltage", 77, 1)
        .addDecimalField("internal_current_three", 78, 1, [0, 100])
        .addUintField("internal_power_three", 79)
        .addDecimalField("ac_input_frequency", 80, 2)
        .addDecimalField("aux_dc_voltage", 83, 1)
        .addDecimalField("aux_dc_current", 84, 1)
        .addUintField("aux_dc_power", 85)
        .addDecimalField("internal_dc_input_voltage", 86, 1)
        .addUintField("internal_dc_input_power", 87)
        .addDecimalField("internal_dc_input_current", 88, 1, [0, 15])
        .addDecimalField("total_battery_voltage", 92, 1)
        .addDecimalField("total_battery_current", 93, 1)
        .addUintField("pack_num", 96)
        .addEnumField("pack_status", 97, BatteryState)
        .addDecimalField("pack_voltage", 98, 2)
        .addUintField("pack_battery_percent", 99)
        .addDecimalArrayField("cell_voltages", 105, 16, 2)
        .addVersionField("pack_bms_version", 201)
        .addDecimalField("dc_input_1_voltage", 163, 1)
        .addUintField("dc_input_1_power", 165)
        .addDecimalField("dc_input_2_voltage", 170, 1)
        .addUintField("dc_input_2_power", 172)
        .addMany(CONTROL);
}
function buildAc500Struct() {
    return new DeviceStruct()
        .addMany(CORE)
        .addDecimalField("power_generation", 41, 1)
        .addEnumField("ac_output_mode", 70, OutputMode)
        .addDecimalField("internal_ac_voltage", 71, 1)
        .addDecimalField("internal_current_one", 72, 1)
        .addUintField("internal_power_one", 73)
        .addDecimalField("internal_ac_frequency", 74, 2)
        .addDecimalField("internal_current_two", 75, 1)
        .addUintField("internal_power_two", 76)
        .addDecimalField("ac_input_voltage", 77, 1)
        .addDecimalField("internal_current_three", 78, 1)
        .addUintField("internal_power_three", 79)
        .addDecimalField("ac_input_frequency", 80, 2)
        .addDecimalField("aux_dc_voltage", 83, 1)
        .addDecimalField("aux_dc_current", 84, 1)
        .addUintField("aux_dc_power", 85)
        .addDecimalField("internal_dc_input_voltage", 86, 1)
        .addUintField("internal_dc_input_power", 87)
        .addDecimalField("internal_dc_input_current", 88, 1)
        .addDecimalField("total_battery_voltage", 92, 1)
        .addDecimalField("total_battery_current", 93, 1)
        .addUintField("pack_num", 96)
        .addDecimalField("pack_voltage", 98, 2)
        .addUintField("pack_battery_percent", 99)
        .addDecimalArrayField("cell_voltages", 105, 16, 2)
        .addDecimalField("dc_input_1_voltage", 163, 1)
        .addUintField("dc_input_1_power", 165)
        .addDecimalField("dc_input_2_voltage", 170, 1)
        .addUintField("dc_input_2_power", 172)
        .addMany(CONTROL);
}
function buildAc60Struct() {
    return new DeviceStruct()
        .addUintField("total_battery_percent", 102)
        .addSwapStringField("device_type", 110, 6)
        .addSerialNumberField("serial_number", 116)
        .addDecimalField("power_generation", 154, 1)
        .addSwapStringField("device_type", 1101, 6)
        .addSerialNumberField("serial_number", 1107)
        .addDecimalField("power_generation", 1202, 1)
        .addSwapStringField("battery_type", 6101, 6)
        .addSerialNumberField("battery_serial_number", 6107)
        .addVersionField("bcu_version", 6175);
}
function buildEb3aStruct() {
    return new DeviceStruct()
        .addMany(CORE)
        .addDecimalField("ac_input_voltage", 77, 1)
        .addDecimalField("internal_dc_input_voltage", 86, 2)
        .addBoolField("ac_output_on", 3007)
        .addBoolField("dc_output_on", 3008)
        .addEnumField("led_mode", 3034, LedMode)
        .addBoolField("power_off", 3060)
        .addBoolField("eco_on", 3063)
        .addEnumField("eco_shutdown", 3064, EcoShutdown)
        .addEnumField("charging_mode", 3065, ChargingMode)
        .addBoolField("power_lifting_on", 3066);
}
function buildEp500Struct() {
    return new DeviceStruct()
        .addMany(CORE)
        .addDecimalField("power_generation", 41, 1)
        .addEnumField("ac_output_mode", 70, OutputMode)
        .addDecimalField("internal_ac_voltage", 71, 1)
        .addDecimalField("internal_current_one", 72, 1)
        .addUintField("internal_power_one", 73)
        .addDecimalField("internal_ac_frequency", 74, 2)
        .addDecimalField("internal_current_two", 75, 1)
        .addUintField("internal_power_two", 76)
        .addDecimalField("ac_input_voltage", 77, 1)
        .addDecimalField("internal_current_three", 78, 1)
        .addUintField("internal_power_three", 79)
        .addDecimalField("ac_input_frequency", 80, 2)
        .addDecimalField("internal_dc_input_voltage", 86, 1)
        .addUintField("internal_dc_input_power", 87)
        .addDecimalField("internal_dc_input_current", 88, 1, [0, 15])
        .addDecimalField("total_battery_voltage", 92, 1)
        .addDecimalField("pack_voltage", 92, 1)
        .addUintField("pack_battery_percent", 94)
        .addUintField("pack_num", 96)
        .addDecimalArrayField("cell_voltages", 105, 16, 2)
        .addMany(CONTROL);
}
function buildEp600Struct() {
    return new DeviceStruct()
        .addUintField("total_battery_percent", 102)
        .addSwapStringField("device_type", 110, 6)
        .addSerialNumberField("serial_number", 116)
        .addDecimalField("power_generation", 154, 1)
        .addSwapStringField("device_type", 1101, 6)
        .addSerialNumberField("serial_number", 1107)
        .addDecimalField("power_generation", 1202, 1)
        .addUintField("battery_range_start", 2022)
        .addUintField("battery_range_end", 2023)
        .addUintField("max_ac_input_power", 2213)
        .addUintField("max_ac_input_current", 2214)
        .addUintField("max_ac_output_power", 2215)
        .addUintField("max_ac_output_current", 2216)
        .addSwapStringField("battery_type", 6101, 6)
        .addSerialNumberField("battery_serial_number", 6107)
        .addVersionField("bcu_version", 6175)
        .addVersionField("bmu_version", 6178)
        .addVersionField("safety_module_version", 6181)
        .addVersionField("high_voltage_module_version", 6184);
}
// ---------------------------------------------------------------------------
// Builder map (consumed by definition.ts)
// ---------------------------------------------------------------------------
export { buildAc200mStruct, buildAc300Struct, buildAc500Struct, buildAc60Struct, buildEb3aStruct, buildEp500Struct, buildEp600Struct };
