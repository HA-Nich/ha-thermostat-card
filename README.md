# HA-Nich Thermostat Card

A custom Lovelace thermostat card for Home Assistant. It shows the **room sensor**
temperature as the big dial number and the **radiator valve (TRV) internal probe**
as a secondary reading, with two dial markers (current temperature and setpoint),
tap/drag setpoint control, an optimistic UI to mask Zigbee lag, a boost button,
a preset picker (including a **Manual** mode), a "room in use" toggle, a
per-room accent colour, and an optional open-window warning banner.

Changing the setpoint by hand (dial or +/-) switches the room to **Manual** and
holds it there until a preset or Auto is chosen again — see `manual_temp_entity`.

Built for a whole-house heating system (SONOFF TRV-ZBT valves + SONOFF MINI-ZBD
boiler relay, with Home Assistant acting as the thermostat).

## Installation (HACS custom repository)

1. In Home Assistant, open **HACS**.
2. Three-dot menu → **Custom repositories**.
3. Add this repository's URL and set the category to **Dashboard** (Lovelace).
4. Install **HA-Nich Thermostat Card**.
5. HACS registers the dashboard resource automatically.

## Card configuration

```yaml
type: custom:ha-nich-thermostat-card
entity: climate.bedroom_1_trv
current_temp_entity: sensor.bedroom_1_sensor_temperature
trv_temp_entity: sensor.bedroom_1_trv_local_temperature
preset_select: input_select.heating_bedroom_1_preset
manual_temp_entity: input_number.heating_bedroom_1_manual_temp   # optional
used_boolean: input_boolean.heating_bedroom_1_used
boost_script: script.heating_boost_toggle
boost_slug: bedroom_1_trv
open_window_entity: binary_sensor.bedroom_1_window   # optional
accent: "#42a5f5"
```

| Option | Required | Description |
| --- | --- | --- |
| `entity` | yes | The `climate.*` entity for the room. |
| `current_temp_entity` | yes | Room sensor temperature (the big dial number). |
| `trv_temp_entity` | yes | TRV internal probe temperature (secondary reading). |
| `preset_select` | no | `input_select.*` driving the preset picker. Include a `Manual` option to enable manual mode. |
| `manual_temp_entity` | no | `input_number.*` holding the manual setpoint. When set, changing the setpoint by dial/+/- writes this helper and switches `preset_select` to `Manual`; the room stays Manual until another preset is picked. Requires a `Manual` option in `preset_select` and your target logic to honour it. |
| `used_boolean` | no | `input_boolean.*` for the "room in use" toggle. |
| `boost_script` | no | Script called by the boost (flame) button. |
| `boost_slug` | no | TRV slug passed to the boost script. |
| `open_window_entity` | no | `binary_sensor.*` that shows an open-window banner. |
| `accent` | no | Hex colour for the per-room accent. |

## Licence

MIT. See [LICENSE](LICENSE).
