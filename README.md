# ioBroker.mcz-maestro

Unofficial ioBroker adapter for compatible **MCZ Maestro pellet stoves** using the MCZ Maestro cloud.

> **Important:** This is an independent community project by **dataeasy**. It is not affiliated with,
> endorsed by, or supported by MCZ Group. MCZ and Maestro are trademarks of their respective owners.
> The cloud interface used by this adapter is not documented here as an official public developer API
> and may change without notice.

## Features

- MCZ Maestro cloud login and automatic device discovery
- periodic retrieval of appliance Status and State
- read-only raw status/state data points
- separate power-on and power-off command buttons
- target-temperature control
- power-level control
- operating-mode control
- Eco / saving-mode control
- connection and command diagnostics
- compact model metadata to avoid creating thousands of ioBroker objects

## Tested hardware

Initial development and testing were performed with an MCZ Air Matic 10 core.

MCZ exposes model-specific command configurations. Other Maestro models may behave differently.
Please report tested models through GitHub Issues without publishing private device identifiers.

Manufacturer: https://www.mcz.it/

## Important objects

| State | Access | Purpose |
| --- | --- | --- |
| `climate.isOn` | read | Interpreted physical stove state |
| `climate.targetTemperature` | read/write | Target room temperature |
| `climate.currentTemperature` | read | Current room temperature |
| `climate.powerLevel` | read/write | Power level |
| `climate.mode` | read/write | Operating mode |
| `climate.ecoMode` | read/write | Eco / saving mode |
| `climate.operatingState` | read | Current MCZ operating phase |
| `commands.powerOn` | button | Start stove |
| `commands.powerOff` | button | Stop stove |
| `commands.refresh` | button | Refresh immediately |
| `commands.lastResult` | read | Last cloud command result |
| `commands.lastError` | read | Last cloud command error |

Power commands are deliberately separate from `climate.isOn`: on the initially tested model the MCZ
power command behaves as an action trigger, while the actual appliance state is reported separately.

## Configuration

Configure the MCZ Maestro account username/e-mail and password. Optionally select a device ID if the
account contains multiple appliances and choose a polling interval.

Never publish credentials, auth tokens, serial numbers, MAC addresses, coordinates, SSIDs, or unredacted
device exports in GitHub issues.

## Safety

Only normal user-facing controls are writable. Service, factory-reset, combustion, calibration and
maintenance parameters are intentionally not exposed as writable ioBroker states.

Pellet stoves are combustion appliances. Test support for new models while physically monitoring the
appliance and retain the manufacturer's normal controls and safety procedures.

## Development

```bash
npm install
npm test
npm run check
```

Repository: https://github.com/Datzaeasy/ioBroker.mcz-maestro

## Changelog

### 0.3.3 (2026-10-06)

- added `common.keywords`
- raised minimum js-controller dependency to 5.0.19
- marked the password as protected and encrypted native configuration
- removed deprecated `common.title`
- completed the translations requested by the ioBroker repository checker

### 0.3.2 (2026-10-06)

- updated `io-package.json` to the current ioBroker schema
- changed adapter category to `climate-control`
- added `common.news`, `common.icon`, `common.extIcon` and `licenseInformation`
- removed deprecated/invalid `common.author` and `common.license`
- added an original neutral adapter icon
- enabled JSON Config i18n and added English/German translations

### 0.3.1 (2026-10-06)

- corrected GitHub repository metadata for the ioBroker repository checker
- added `@iobroker/testing` 6.2.x as a development dependency
- added official ioBroker package-file tests
- migrated CI to the shared ioBroker adapter testing action
- added Node.js 22, 24 and 26 CI coverage

### 0.3.0 (2026-10-06)

- prepared the proven 0.2.3 implementation for public GitHub development
- retained the working separate power-on and power-off triggers
- removed device-specific identifiers from public documentation
- added MIT license, contribution/security guidance, issue template and CI
- set Node.js requirement to 20+
- corrected command-button metadata to button semantics
- documented model-specific MCZ behavior and safety boundaries

### 0.2.3

- fixed power-off for the initially tested timed boolean MCZ power configuration
- retained compact model representation to avoid excessive ioBroker object counts

## License

MIT
