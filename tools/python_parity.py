import argparse
import base64
import enum
import json
import os
import sys
from decimal import Decimal


ROOT = os.path.dirname(os.path.dirname(__file__))
PYTHON_LIB_ROOT = os.path.join(os.path.dirname(ROOT), "bluetti_mqtt")
sys.path.insert(0, PYTHON_LIB_ROOT)

from bluetti_mqtt.core.commands import ReadHoldingRegisters  # noqa: E402
from bluetti_mqtt.core.devices.ac200m import AC200M  # noqa: E402
from bluetti_mqtt.core.devices.ac300 import AC300  # noqa: E402
from bluetti_mqtt.core.devices.ac500 import AC500  # noqa: E402
from bluetti_mqtt.core.devices.ac60 import AC60  # noqa: E402
from bluetti_mqtt.core.devices.eb3a import EB3A  # noqa: E402
from bluetti_mqtt.core.devices.ep500 import EP500  # noqa: E402
from bluetti_mqtt.core.devices.ep500p import EP500P  # noqa: E402
from bluetti_mqtt.core.devices.ep600 import EP600  # noqa: E402


MAX_SAFE_INTEGER = (1 << 53) - 1
DEVICE_FACTORIES = {
    "AC200M": AC200M,
    "AC300": AC300,
    "AC500": AC500,
    "AC60": AC60,
    "EB3A": EB3A,
    "EP500": EP500,
    "EP500P": EP500P,
    "EP600": EP600,
}


def normalize(value):
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, enum.Enum):
        return value.name
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, int) and abs(value) > MAX_SAFE_INTEGER:
        return str(value)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", required=True)
    parser.add_argument("--device-name", required=True)
    parser.add_argument("--starting-address", required=True, type=int)
    parser.add_argument("--quantity", required=True, type=int)
    parser.add_argument("--response-base64", required=True)
    args = parser.parse_args()

    command = ReadHoldingRegisters(args.starting_address, args.quantity)
    device = build_device(args.address, args.device_name)
    response = base64.b64decode(args.response_base64)
    body = command.parse_response(response)
    parsed = device.parse(args.starting_address, body)

    payload = {
        "commandBase64": base64.b64encode(bytes(command)).decode("ascii"),
        "parsed": normalize(parsed),
    }
    print(json.dumps(payload, separators=(",", ":")))


def build_device(address, device_name):
    for prefix, cls in DEVICE_FACTORIES.items():
        if device_name.startswith(prefix):
            serial = device_name[len(prefix):]
            return cls(address, serial)
    raise ValueError(f"Unsupported device name: {device_name}")


if __name__ == "__main__":
    main()
