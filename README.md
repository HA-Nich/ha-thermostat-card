# HA-Nich Thermostat Card

A custom Lovelace thermostat card for Home Assistant. It shows the **room sensor**
temperature as the big dial number and the **radiator valve (TRV) internal probe**
as a secondary reading, with a colour-graded dial, tap/drag set point control,
an optimistic UI to mask Zigbee lag, a boost button, a preset picker (including
a **Manual** mode), a "room in use" toggle, a per-room accent colour, and an
optional open-window warning banner.

Changing the set point by hand (dial or +/-) switches the room to **Manual** and
holds it there until a preset or Auto is chosen again — see `manual_temp_entity`.

Built for a whole-house heating system (SONOFF TRV-ZBT valves + SONOFF MINI-ZBD
boiler relay, with Home Assistant acting as the thermostat).

## The dial

- **White dot = set point.** It is also the drag handle: drag it, tap the ring,
  or use +/- to change the target.
- **Coloured arc = current room temperature.** The whole scale is drawn dim, and
  the same gradient is drawn bright from the dial minimum up to the current
  reading of the room sensor.
- **Coloured handle and big number.** The round end handle of the arc and the big
  centre number take the gradient colour at the current temperature.
- **Colour-graded by absolute temperature.** The colour depends on the actual
  temperature, not on where it sits on the dial, so 20 °C is always the same
  green in every room. The default stops are:

  | Temperature | Colour |
  | --- | --- |
  | 15 | `#2962ff` (blue) |
  | 16.5 | `#29b6f6` (light blue) |
  | 18 | `#ffb300` (amber) |
  | 20 | `#43a047` (green) |
  | 21 | `#43a047` (green) |
  | 22 | `#e53935` (red) |

  Override them with `color_stops`, a list of `[temperature, colour]` pairs. An
  invalid list falls back to the defaults.
- **Targets outside the range** (for example a 5 °C frost guard) pin the white
  dot to the nearest end of the dial. Dragging, tapping and +/- can only set
  targets inside the live range.

### Dial range

The dial minimum and maximum are resolved in this order:

1. `min_entity` / `max_entity`: `input_number.*` entities read live, so the dial
   follows your cold floor and ceiling helpers.
2. Static `min` / `max` options.
3. Built-in fallback of **15 to 22**.

A `max_entity` value that is non-numeric, or lower than the minimum plus 3, is
ignored (the static or built-in maximum is used instead). If the minimum ends up
at or above the maximum, the range falls back to 15 to 22.

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
calling_entity: sensor.heating_rooms_calling          # optional
min_entity: input_number.heating_cold_floor           # optional, live dial minimum
max_entity: input_number.heating_house_ceiling        # optional, live dial maximum
color_stops: [[15, "#2962ff"], [22, "#e53935"]]       # optional
accent: "#42a5f5"
```

| Option | Required | Description |
| --- | --- | --- |
| `entity` | yes | The `climate.*` entity for the room. |
| `current_temp_entity` | yes | Room sensor temperature (the big dial number and the coloured arc). |
| `trv_temp_entity` | yes | TRV internal probe temperature (secondary reading). |
| `preset_select` | no | `input_select.*` driving the preset picker. Include a `Manual` option to enable manual mode. |
| `manual_temp_entity` | no | `input_number.*` holding the manual set point. When set, changing the set point by dial/+/- writes this helper and switches `preset_select` to `Manual`; the room stays Manual until another preset is picked. Requires a `Manual` option in `preset_select` and your target logic to honour it. |
| `used_boolean` | no | `input_boolean.*` for the "room in use" toggle. |
| `boost_script` | no | Script called by the boost (flame) button. |
| `boost_slug` | no | TRV slug passed to the boost script. |
| `open_window_entity` | no | `binary_sensor.*` that shows an open-window banner. |
| `calling_entity` | no | Sensor listing the rooms currently calling for heat; drives the dial glow. |
| `min_entity` | no | `input_number.*` read live as the dial minimum. Falls back to `min`, then 15. |
| `max_entity` | no | `input_number.*` read live as the dial maximum. Ignored unless it is at least the minimum plus 3. Falls back to `max`, then 22. |
| `min` / `max` | no | Static dial range used when the entity options are not set or not valid. Defaults are 15 and 22. |
| `color_stops` | no | List of `[temperature, "#hex"]` pairs for the arc gradient. See the defaults above. |
| `accent` | no | Hex colour for the per-room accent. |

## Licence

MIT. See [LICENSE](LICENSE).
