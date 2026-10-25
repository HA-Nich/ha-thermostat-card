/*
 * HA-Nich Thermostat Card
 * ---------------------------------------------------------------------------
 * A round Nest-style thermostat card for a Home Assistant heating system.
 *
 * WHY THIS EXISTS: the stock / HACS thermostat cards lock the big centre number
 * to the climate entity's own `current_temperature`, which on the SONOFF TRV-ZBT
 * is the TRV's INTERNAL probe (by the radiator). We want the TRUE room reading
 * (a separate room sensor, away from the radiator) as the big number, and keep
 * the TRV probe visible as a second data point. This card lets you point each
 * value at an explicit entity.
 *
 *   - Big centre number   -> current_temp_entity   (the room sensor)
 *   - White dot on the ring -> climate entity's target (drag / +-/ writes it)
 *   - Coloured arc + end handle -> current room temperature (room sensor)
 *   - Small bottom tile    -> trv_temp_entity       (the TRV internal probe)
 *   - Off / Auto buttons   -> climate hvac_mode
 *   - Boost flame          -> boost_select (SONOFF temporary_mode_mode) via a
 *                             script, or directly
 *
 * No build step: plain JS using the LitElement that Home Assistant already
 * ships on the frontend. Drop in config/www/ and add as a dashboard resource.
 *
 * Changelog (card has no version string; patch-level changes):
 *   - Colour-graded dial: the 270deg arc is now a colour gradient keyed to
 *     ABSOLUTE temperature (default 15 blue, 16.5 light blue, 18 amber, 20-21
 *     green, 22 red; override with `color_stops: [[15,"#2962ff"], ...]`). The
 *     whole scale is drawn dim; the same gradient at full brightness is
 *     revealed from the dial minimum up to the CURRENT room temperature. The
 *     round end handle and the big number take the gradient colour at the
 *     current temperature (the halo/glow is unchanged). The white dot is still
 *     the set point and drag handle.
 *   - Dial range: minimum/maximum now default to 15/22 (was 5/30) and can be
 *     read LIVE from input_numbers via `min_entity` / `max_entity` (e.g. the
 *     house cold floor and ceiling), falling back to static `min` / `max`.
 *     A max_entity value that is non-numeric or less than min + 3 is ignored
 *     (the ceiling helper uses low values to mean "no ceiling"); if min >= max
 *     the range falls back to 15/22. Targets outside the range (e.g. a 5C
 *     frost guard) pin the white dot to the nearest end; dragging, tapping and
 *     +/- can only set targets inside the live range.
 *   - Note: a max_entity below min + 3 (i.e. under 18 with the default minimum)
 *     is ignored by the dial, even though the heating package treats a ceiling
 *     of 16 or more as real; such a ceiling still caps targets, but the dial
 *     keeps showing the static max.
 *   - +/- never move a target the wrong way: a 5C frost target ignores "-" and
 *     "+" moves it to the dial minimum. Per-instance SVG ids are used.
 *   - Dial swap: the WHITE DOT now marks the set point (target) and the
 *     coloured ARC (with its end handle) shows the current room-sensor
 *     temperature. Previously the other way round. Arc is hidden when the
 *     room temperature is unavailable. Dragging/tapping still sets the target.
 *
 * Example:
 *   type: custom:ha-nich-thermostat-card
 *   name: Bedroom 1
 *   entity: climate.bedroom_1_trv
 *   current_temp_entity: sensor.bedroom_1_sensor_temperature
 *   trv_temp_entity: sensor.bedroom_1_trv_local_temperature
 *   boost_select: select.bedroom_1_trv_temporary_mode_mode
 *   boost_script: script.heating_boost_toggle
 *   boost_slug: bedroom_1_trv
 *   open_window_entity: binary_sensor.bedroom_1_trv_open_window_detected  # optional
 *   calling_entity: sensor.heating_rooms_calling  # optional — see _isCalling()
 *   min_entity: input_number.heating_cold_floor    # optional, live dial minimum
 *   max_entity: input_number.heating_house_ceiling # optional, live dial maximum
 *   color_stops: [[15, "#2962ff"], [22, "#e53935"]] # optional, see defaults below
 *   accent: "#42a5f5"
 */

// <pure-helpers>
// Pure functions (no DOM / hass access) so they can be unit-tested in Node.
const NICH_DEFAULT_MIN = 15;
const NICH_DEFAULT_MAX = 22;
const NICH_MIN_SPAN = 3; // a max_entity closer than this to the minimum is ignored
const NICH_DEFAULT_STOPS = [
  [15, "#2962ff"],
  [16.5, "#29b6f6"],
  [18, "#ffb300"],
  [20, "#43a047"],
  [21, "#43a047"],
  [22, "#e53935"],
];

function nichHexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Validate a colour-stop list; returns the sorted list or the defaults.
function nichNormaliseStops(stops) {
  if (!Array.isArray(stops) || stops.length < 1) return NICH_DEFAULT_STOPS;
  const out = [];
  for (const s of stops) {
    if (!Array.isArray(s)) return NICH_DEFAULT_STOPS;
    const t = Number(s[0]);
    if (!isFinite(t) || !nichHexToRgb(s[1])) return NICH_DEFAULT_STOPS;
    out.push([t, s[1]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Colour at an absolute temperature: linear RGB interpolation, clamped outside.
function nichColourAt(stops, t) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  const rgb = (v) => {
    const [r, g, b] = nichHexToRgb(v);
    return [r, g, b];
  };
  let c;
  if (t <= first[0]) c = rgb(first[1]);
  else if (t >= last[0]) c = rgb(last[1]);
  else {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        const a = rgb(c0);
        const b = rgb(c1);
        c = a.map((v, j) => v + (b[j] - v) * k);
        break;
      }
    }
  }
  return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

// Temperature -> dial angle (0deg = 12 o'clock, -135 .. +135), clamped.
function nichTempToDeg(t, min, max) {
  return -135 + 270 * Math.min(1, Math.max(0, (t - min) / (max - min)));
}

// Resolve the live dial range. `num(id)` returns a finite number or null.
function nichResolveRange(cfg, num) {
  const fin = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const staticMin = fin(Number(cfg.min)) ?? NICH_DEFAULT_MIN;
  const staticMax = fin(Number(cfg.max)) ?? NICH_DEFAULT_MAX;
  let min = (cfg.min_entity ? fin(num(cfg.min_entity)) : null) ?? staticMin;
  let max = staticMax;
  const liveMax = cfg.max_entity ? fin(num(cfg.max_entity)) : null;
  if (liveMax != null && liveMax >= min + NICH_MIN_SPAN) max = liveMax;
  if (!(min < max)) {
    min = NICH_DEFAULT_MIN;
    max = NICH_DEFAULT_MAX;
  }
  return { min, max };
}
// </pure-helpers>

// Grab LitElement + the `html` tag from Home Assistant's own bundled Lit, so
// this card needs no build step and no external dependencies. We resolve
// LitElement from an element that is guaranteed to exist and be Lit-based.
// NOTE: we do NOT use the static `css` tag at all (its availability on the
// prototype is version-dependent and was throwing a "Configuration error");
// styles are injected via a plain <style> block inside render() instead.
const _LitSource =
  customElements.get("ha-card") ||
  customElements.get("hui-view") ||
  customElements.get("ha-panel-lovelace");
const LitElement = Object.getPrototypeOf(_LitSource);
const LitHtml = LitElement.prototype.html;

class HaNichThermostatCard extends LitElement {
  static get properties() {
    return { hass: {}, _config: {}, _dragTarget: {}, _presetMenuOpen: {}, _pending: {} };
  }

  // Optimistic UI: when the user taps a control we show the new value IMMEDIATELY
  // (stored here) instead of waiting for HA to echo the state back over the
  // Zigbee round-trip, which is what made the card feel laggy. Each pending
  // value self-expires after ~4s, by which point the real state has arrived.
  _setPending(key, value) {
    this._pending = { ...this._pending, [key]: value };
    clearTimeout(this._pendingTimers?.[key]);
    this._pendingTimers = this._pendingTimers || {};
    this._pendingTimers[key] = setTimeout(() => {
      const p = { ...this._pending };
      delete p[key];
      this._pending = p;
    }, 4000);
  }

  _pend(key, fallback) {
    return this._pending && key in this._pending ? this._pending[key] : fallback;
  }

  setConfig(config) {
    if (!config.entity) throw new Error("ha-nich-thermostat-card: 'entity' (a climate.* entity) is required");
    this._pending = {};
    this._config = {
      min: NICH_DEFAULT_MIN,
      max: NICH_DEFAULT_MAX,
      step: 0.5,
      accent: "#ef5350",
      ...config,
    };
    this._stops = nichNormaliseStops(this._config.color_stops);
  }

  // The single place the dial range is resolved: live min_entity / max_entity
  // when set and valid, else static min / max, else 15/22. Used by _clamp, the
  // pointer mapping and render()'s frac().
  _range() {
    return nichResolveRange(this._config, (id) => this._num(id));
  }

  getCardSize() {
    return 5;
  }

  _st(id) {
    return this.hass && id ? this.hass.states[id] : undefined;
  }

  _num(id) {
    const s = this._st(id);
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }

  // Is THIS room in the house's own "genuinely calling" list? Reads the
  // `rooms` attribute of sensor.heating_rooms_calling (packages/heating/
  // sensors.yaml), a comma-joined string of room labels such as "Kitchen,
  // Shower Room" that already uses the exact same labels as this card's
  // `name` config. This is deliberately separate from hvac_action: the TRV's
  // own valve can be open while fine-trimming the last fraction of a degree
  // without the room being "calling" by the house-wide weighted/deadband
  // rule, and that looseness is intentional (see sensors.yaml). Returns null
  // (unknown) if no calling_entity is configured, so the caller can fall
  // back to the old hvac_action-driven behaviour.
  _isCalling() {
    const c = this._config;
    if (!c.calling_entity) return null;
    const s = this._st(c.calling_entity);
    const list = s?.attributes?.rooms;
    if (!list) return false;
    const label = c.name;
    return list
      .split(",")
      .map((r) => r.trim())
      .includes(label);
  }

  // --- actions ---------------------------------------------------------------
  _clamp(t, rng = this._range()) {
    const c = this._config;
    return Math.min(rng.max, Math.max(rng.min, Math.round(t / c.step) * c.step));
  }

  // Per-instance SVG ids so several cards on one page can never clash.
  _id(name) {
    HaNichThermostatCard._n = HaNichThermostatCard._n || 0;
    this._uid = this._uid || `ha-nich-${++HaNichThermostatCard._n}`;
    return `${this._uid}-${name}`;
  }

  // +/- buttons: step from the current target, but never in the wrong
  // direction. A target outside the live dial range (e.g. a 5C frost guard)
  // is ignored by the opposite button and moves into range with the
  // matching one, rather than jumping across the dial.
  _stepTemp(cur, dir) {
    if (cur == null || isNaN(cur)) return;
    const rng = this._range();
    if ((dir < 0 && cur <= rng.min) || (dir > 0 && cur >= rng.max)) return;
    this._setTemp(cur + dir * this._config.step);
  }

  // Commit a setpoint to HA. Used by +/- and on drag-release.
  //
  // When a manual_temp_entity is configured, a user-initiated setpoint change
  // means "go to Manual mode at this temperature": we write the manual helper
  // and flip the room's preset to "Manual" (and wake the TRV if it was off), so
  // the room's target sensor + apply-targets hold the TRV at this value and it
  // stays Manual until a preset/Auto is chosen again. We still push the TRV
  // setpoint directly for an instant response (apply-targets reconciles it).
  // Without a manual_temp_entity it falls back to a plain climate setpoint.
  _setTemp(t) {
    const v = this._clamp(t);
    this._setPending("target", v); // optimistic: show it immediately
    const c = this._config;

    if (c.manual_temp_entity && c.preset_select) {
      this._setPending("preset", "Manual");
      // Wake the TRV if it was off, else the Manual target is ignored.
      const climate = this._st(c.entity);
      if (climate && climate.state === "off") {
        this._setPending("mode", "auto");
        this.hass.callService("climate", "set_hvac_mode", {
          entity_id: c.entity, hvac_mode: "auto",
        });
      }
      this.hass.callService("input_number", "set_value", {
        entity_id: c.manual_temp_entity, value: v,
      });
      // Only switch the preset if it isn't already Manual (avoids a redundant
      // event each drag tick).
      if (this._currentPreset() !== "Manual") {
        this.hass.callService("input_select", "select_option", {
          entity_id: c.preset_select, option: "Manual",
        });
      }
    }

    // Push the TRV setpoint directly too, for an instant dial response.
    this.hass.callService("climate", "set_temperature", {
      entity_id: c.entity,
      temperature: v,
    });
  }

  _targetTemp() {
    const s = this._st(this._config.entity);
    return s ? parseFloat(s.attributes.temperature) : null;
  }

  _setMode(mode) {
    this._setPending("mode", mode); // optimistic
    this.hass.callService("climate", "set_hvac_mode", {
      entity_id: this._config.entity,
      hvac_mode: mode,
    });
  }

  // --- preset picker ---------------------------------------------------------
  // The "mode" button opens a picker for the room's preset input_select
  // (Auto = run the heating algorithm/schedule; Comfort/Eco/Sleep/Cool/Off =
  // manually pin the room). Options are read live from the entity so they
  // always match the helper definition.
  _presetOptions() {
    const s = this._st(this._config.preset_select);
    return (s && s.attributes.options) || ["Auto", "Comfort", "Eco", "Sleep", "Cool", "Off"];
  }

  _currentPreset() {
    const s = this._st(this._config.preset_select);
    return s ? s.state : null;
  }

  _togglePresetMenu() {
    if (!this._config.preset_select) {
      // No preset entity configured — fall back to just setting Auto mode.
      this._setMode("auto");
      return;
    }
    this._presetMenuOpen = !this._presetMenuOpen;
  }

  _pickPreset(opt) {
    this._setPending("preset", opt); // optimistic
    // If the climate is currently OFF, picking a preset should also wake the
    // TRV back up (otherwise the preset sets a target the off TRV ignores, and
    // the dial stays dark). Turn it back to 'auto' so it resumes responding.
    const climate = this._st(this._config.entity);
    if (climate && climate.state === "off") {
      this._setPending("mode", "auto");
      this.hass.callService("climate", "set_hvac_mode", {
        entity_id: this._config.entity,
        hvac_mode: "auto",
      });
    }
    // Picking "Manual" from the menu: seed the manual helper from the current
    // target so the room holds where it is until the user dials a new value
    // (rather than jumping to a stale manual_temp).
    if (opt === "Manual" && this._config.manual_temp_entity) {
      const cur = this._pend("target", this._targetTemp());
      if (cur != null && !isNaN(cur)) {
        this.hass.callService("input_number", "set_value", {
          entity_id: this._config.manual_temp_entity, value: cur,
        });
      }
    }
    this.hass.callService("input_select", "select_option", {
      entity_id: this._config.preset_select,
      option: opt,
    });
    this._presetMenuOpen = false;
  }

  _toggleUsed() {
    if (!this._config.used_boolean) return;
    const now = this._st(this._config.used_boolean)?.state === "on";
    this._setPending("used", !now); // optimistic
    this.hass.callService("input_boolean", "toggle", {
      entity_id: this._config.used_boolean,
    });
  }

  _toggleBoost() {
    const c = this._config;
    const boosting = c.boost_select ? this._st(c.boost_select)?.state === "boost" : false;
    this._setPending("boost", !boosting); // optimistic
    if (c.boost_script && c.boost_slug) {
      // Use the heating_boost_toggle script (handles duration + cancel).
      const svc = c.boost_script.split(".");
      this.hass.callService(svc[0], svc[1], { trv_slug: c.boost_slug });
    } else if (c.boost_select) {
      this.hass.callService("select", "select_option", {
        entity_id: c.boost_select,
        option: boosting ? "disabled" : "boost",
      });
    }
  }

  // --- geometry for the dial -------------------------------------------------
  _polar(cx, cy, r, angleDeg) {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  // 270-degree arc from -135 to +135 (gap at the bottom).
  _arcPath(cx, cy, r, startFrac, endFrac) {
    const span = 270;
    const start = -135 + span * startFrac;
    const end = -135 + span * endFrac;
    const s = this._polar(cx, cy, r, start);
    const e = this._polar(cx, cy, r, end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  // Convert a pointer position on the SVG to a temperature along the 270° arc.
  _tempFromPointer(svg, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let ang = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90;
    if (ang > 180) ang -= 360;
    let frac = Math.min(1, Math.max(0, (ang + 135) / 270));
    const rng = this._range();
    return this._clamp(rng.min + frac * (rng.max - rng.min), rng);
  }

  // Is the pointer on the RING (not the empty centre)? Prevents a tap on the
  // big number / mode icon from scrubbing the setpoint. Band is a fraction of
  // the dial radius — adapted from the original card's _isRingHit.
  _isRingHit(svg, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rad = Math.hypot(clientX - cx, clientY - cy) / (rect.width / 2 || 1);
    return rad >= 0.55 && rad <= 1.05; // the ring annulus
  }

  // Tap-vs-drag (adapted from material-thermostat-card):
  //  - Mouse: begin dragging immediately.
  //  - Touch: ARM a tap; only start dragging once the finger moves past a 10px
  //    slop, so a tap sets the point and a vertical swipe still scrolls the page
  //    (touch-action: pan-y on the svg). A tap commits to the tapped position.
  // Dragging previews locally (no service spam) and commits ONE call on release.
  _onPointerDown(ev) {
    if (this.disabled) return;
    this._svg = ev.currentTarget;
    if (!this._isRingHit(this._svg, ev.clientX, ev.clientY)) return;
    this._pressX = ev.clientX;
    this._pressY = ev.clientY;
    if (ev.pointerType !== "touch") {
      this._beginDrag(ev);
    } else {
      this._tapArmed = true;
    }
  }

  _beginDrag(ev) {
    ev.preventDefault();
    this._svg.setPointerCapture?.(ev.pointerId);
    this._tapArmed = false;
    this._dragging = true;
    this._dragTarget = this._tempFromPointer(this._svg, ev.clientX, ev.clientY);
    this.requestUpdate();
  }

  _movedPastSlop(ev) {
    return Math.hypot(ev.clientX - this._pressX, ev.clientY - this._pressY) > 10;
  }

  _onPointerMove(ev) {
    if (this._tapArmed && this._movedPastSlop(ev)) this._beginDrag(ev);
    if (this._dragging) {
      this._dragTarget = this._tempFromPointer(this._svg, ev.clientX, ev.clientY);
      this.requestUpdate(); // local preview only, no HA call
    }
  }

  _onPointerUp(ev) {
    if (this._tapArmed) {
      // A clean tap (touch, no drag) — jump the setpoint to the tapped spot.
      this._tapArmed = false;
      this._setTemp(this._tempFromPointer(this._svg, ev.clientX, ev.clientY));
      return;
    }
    if (this._dragging) {
      this._dragging = false;
      const t = this._dragTarget;
      this._dragTarget = null;
      if (t != null) this._setTemp(t); // the single committing call
    }
  }

  _onPointerCancel() {
    this._tapArmed = false;
    this._dragging = false;
    this._dragTarget = null;
    this.requestUpdate();
  }

  // Build the gradient arc segments (~54 butt-capped 5deg paths, each coloured
  // by the temperature at its midpoint) once per range/stops change. SVG has no
  // conic gradient. Segments overlap by a hair so no seams show.
  updated(changed) {
    super.updated?.(changed);
    const g = this.shadowRoot?.getElementById(this._id("segs"));
    if (!g || !this._segKey || g.dataset.key === this._segKey) return;
    const rng = this._range();
    const N = 54;
    const NS = "http://www.w3.org/2000/svg";
    while (g.firstChild) g.removeChild(g.firstChild);
    for (let i = 0; i < N; i++) {
      const t = rng.min + ((i + 0.5) / N) * (rng.max - rng.min);
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", this._arcPath(110, 110, 92, i / N, Math.min(1, (i + 1) / N + 0.004)));
      p.setAttribute("stroke", nichColourAt(this._stops, t));
      p.setAttribute("fill", "none");
      p.setAttribute("stroke-width", "10");
      g.appendChild(p);
    }
    g.dataset.key = this._segKey;
  }

  render() {
    if (!this.hass || !this._config) return LitHtml``;
    const c = this._config;
    const climate = this._st(c.entity);
    if (!climate) {
      return LitHtml`<ha-card><div class="warn">Unknown entity: ${c.entity}</div></ha-card>`;
    }

    // Prefer optimistic pending values (set the instant the user taps) over the
    // real HA state, so the UI reacts immediately instead of waiting for the
    // Zigbee round-trip. Pending values self-expire after ~4s.
    const mode = this._pend("mode", climate.state); // off / auto / heat
    const action = climate.attributes.hvac_action; // heating / idle / off
    const realTarget = this._pend("target", parseFloat(climate.attributes.temperature));
    // While dragging, show the live preview target instead of the committed one.
    const target = this._dragTarget != null ? this._dragTarget : realTarget;
    // Don't allow scrubbing the setpoint when the TRV is off/unavailable.
    this.disabled = mode === "off" || climate.state === "unavailable" || climate.state === "unknown";

    // Big number = the ROOM SENSOR (explicit entity), falling back to the
    // climate current_temperature only if the room sensor is missing.
    const roomV = this._num(c.current_temp_entity);
    const climateCur = parseFloat(climate.attributes.current_temperature);
    const bigNum = roomV ?? (isNaN(climateCur) ? null : climateCur);

    // TRV internal probe for the small tile.
    const trvV = this._num(c.trv_temp_entity);

    const boosting = this._pend("boost", c.boost_select ? this._st(c.boost_select)?.state === "boost" : false);
    const preset = this._pend("preset", this._currentPreset()); // room preset (Auto / Comfort / ...)
    const used = this._pend("used", c.used_boolean ? this._st(c.used_boolean)?.state === "on" : null);
    // Optional open-window warning: if the configured binary_sensor is on, the
    // TRV has paused heating for that room (window/fast-drop detection).
    const openWindow = c.open_window_entity && this._st(c.open_window_entity)?.state === "on";

    const rng = this._range(); // live dial range, resolved once for this render
    const frac = (v) => Math.min(1, Math.max(0, (v - rng.min) / (rng.max - rng.min)));
    const curFrac = bigNum != null ? frac(bigNum) : null;
    const tgtFrac = !isNaN(target) ? frac(target) : 0;

    const cx = 110,
      cy = 110,
      r = 92;
    // Gradient colour at the current temperature (big number + end handle).
    const curColour = bigNum != null ? nichColourAt(this._stops, bigNum) : null;
    // Bright layer is a clip sector from the dial centre, from the dial
    // minimum (-135deg) up to the current temperature. Empty if unavailable.
    const clipEnd = curFrac != null ? nichTempToDeg(bigNum, rng.min, rng.max) : -135;
    const sA = this._polar(cx, cy, 120, -135);
    const sB = this._polar(cx, cy, 120, clipEnd);
    const clipPath = `M ${cx} ${cy} L ${sA.x} ${sA.y} A 120 120 0 ${clipEnd + 135 > 180 ? 1 : 0} 1 ${sB.x} ${sB.y} Z`;
    const capA = this._polar(cx, cy, r, -135);
    const capB = this._polar(cx, cy, r, 135);
    const colMin = nichColourAt(this._stops, rng.min);
    const colMax = nichColourAt(this._stops, rng.max);
    // The ~54 gradient segments are built imperatively in updated() (nested
    // Lit html templates would be parsed as HTML, not SVG); this key says when
    // they need rebuilding.
    this._segKey = `${rng.min}|${rng.max}|${JSON.stringify(this._stops)}`;
    // Markers use the ORBIT technique (rotated HTML divs over the dial), the
    // same approach the material-thermostat-card uses — far more reliable than
    // computing SVG x/y. A marker is a full-size layer rotated so its top-pinned
    // dot lands on the arc. 0deg = top (12 o'clock); the 270° arc runs from
    // -135deg (bottom-left) to +135deg (bottom-right).
    const tgtDeg = -135 + 270 * tgtFrac;
    const curDeg = curFrac != null ? -135 + 270 * curFrac : null;
    const labelsApart = curFrac != null && Math.abs(curFrac - tgtFrac) > 0.08;

    // Dial colour (glow/halo): driven by the house's own "genuinely calling"
    // decision (sensor.heating_rooms_calling, via _isCalling()), NOT by the
    // TRV's raw hvac_action. The TRV can leave its valve open fine-trimming
    // the last fraction of a degree without the room being "calling" by the
    // house-wide weighted/deadband rule, and that's intentional (see
    // _isCalling() above) — the dial shouldn't look like it's "in trouble"
    // for a room the house considers satisfied. hvac_action still drives the
    // separate Open/Idle/Off text label below, unchanged.
    // Falls back to the old hvac_action-driven colour if no calling_entity is
    // configured for this card (e.g. during rollout) so nothing goes dark.
    const calling = this._isCalling();
    const isHeatingNow = calling != null ? calling : action === "heating";
    const halo = boosting
      ? "#ff9800"
      : mode === "off"
      ? "var(--state-climate-off-color, #607d8b)"
      : isHeatingNow
      ? "var(--state-climate-heat-color, #ff8100)"
      : "var(--state-climate-auto-color, #66bb6a)";

    return LitHtml`
      <style>${HaNichThermostatCard.styleText}</style>
      <ha-card style="--accent:${c.accent}; --dial-color:${halo};">
        <div class="title">${c.name || climate.attributes.friendly_name || c.entity}</div>

        ${openWindow
          ? LitHtml`<div class="open-window">🪟 Open window — heating paused</div>`
          : ""}

        <div class="dial-wrap">
          <svg viewBox="0 0 220 220" class="dial"
               @pointerdown=${this._onPointerDown}
               @pointermove=${this._onPointerMove}
               @pointerup=${this._onPointerUp}
               @pointercancel=${this._onPointerCancel}>
            <defs>
              <!-- Soft mode-coloured halo: full colour at centre, fading to
                   transparent at the rim (adapted from the original card). -->
              <radialGradient id="${this._id("glow")}" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${halo}" stop-opacity="0.30" />
                <stop offset="45%" stop-color="${halo}" stop-opacity="0.14" />
                <stop offset="75%" stop-color="${halo}" stop-opacity="0.04" />
                <stop offset="100%" stop-color="${halo}" stop-opacity="0" />
              </radialGradient>
              <!-- Gradient arc segments (filled in updated()), used twice:
                   dim full track + bright layer clipped to the current temp. -->
              <g id="${this._id("segs")}" class="segs"></g>
              <clipPath id="${this._id("clip")}"><path d=${clipPath} /></clipPath>
            </defs>
            <circle class="glow" cx="110" cy="110" r="104" fill="url(#${this._id("glow")})"
                    style="opacity:${mode === "off" ? 0.4 : 1}" />
            <!-- Dim full-scale gradient track (with rounded end caps) -->
            <g class="track" opacity="0.22">
              <use href="#${this._id("segs")}" />
              <circle cx=${capA.x} cy=${capA.y} r="5" fill=${colMin} />
              <circle cx=${capB.x} cy=${capB.y} r="5" fill=${colMax} />
            </g>
            <!-- Bright gradient, revealed from the dial minimum to the current temp -->
            <g class="fill" style="display:${curFrac != null ? "inline" : "none"}">
              <g clip-path="url(#${this._id("clip")})"><use href="#${this._id("segs")}" /></g>
              <circle cx=${capA.x} cy=${capA.y} r="5" fill=${colMin} />
              <circle cx=${capB.x} cy=${capB.y} r="5" fill=${colMax}
                      style="display:${curFrac != null && curFrac >= 1 ? "inline" : "none"}" />
            </g>
            <text x="110" y="104" class="big" style="fill:${curColour || halo};">
              ${bigNum != null ? bigNum.toFixed(1) : "N/A"}<tspan class="deg">°C</tspan>
            </text>
            <text x="110" y="130" class="sub">
              set ${!isNaN(target) ? target.toFixed(1) + "°" : "—"}
            </text>
          </svg>

          <!-- Marker overlay (rotated-div "orbit" technique) over the SVG. -->
          <div class="markers">
            ${curDeg != null
              ? LitHtml`
                  <!-- Current-temperature end handle (coloured, end of the arc) -->
                  <div class="orbit" style="transform: rotate(${curDeg}deg)">
                    <div class="o-dot current" style="background:${curColour}"></div>
                  </div>
                  ${labelsApart
                    ? LitHtml`
                        <div class="orbit" style="transform: rotate(${curDeg}deg)">
                          <div class="o-label" style="transform: translate(-50%,-50%) rotate(${-curDeg}deg)">
                            ${bigNum.toFixed(1)}°
                          </div>
                        </div>
                      `
                    : ""}
                `
              : ""}
            <!-- Setpoint dot (white) — drawn last so it sits on top -->
            <div class="orbit" style="transform: rotate(${tgtDeg}deg)">
              <div class="o-dot setpoint"></div>
            </div>
          </div>

          <div class="bump">
            <button @click=${() => this._stepTemp(realTarget, -1)}>−</button>
            <button @click=${() => this._stepTemp(realTarget, 1)}>+</button>
          </div>
        </div>

        <div class="modes">
          <button class="mode ${mode === "off" ? "on" : ""}"
                  @click=${() => this._setMode(mode === "off" ? "auto" : "off")}
                  title=${mode === "off" ? "Turn on (Auto)" : "Turn off"}>
            <ha-icon icon="mdi:power"></ha-icon>
          </button>
          <button class="mode preset ${preset && preset !== "Auto" ? "manual" : mode === "auto" ? "on" : ""}"
                  @click=${() => this._togglePresetMenu()} title="Preset / Mode">
            <ha-icon icon=${preset === "Auto" || !preset ? "mdi:calendar-sync" : "mdi:tune-variant"}></ha-icon>
            <span class="preset-lbl">${preset || "Auto"}</span>
          </button>
          <button class="mode boost ${boosting ? "on" : ""}" @click=${() => this._toggleBoost()} title="Boost">
            <ha-icon icon="mdi:fire"></ha-icon>
          </button>
          ${c.used_boolean
            ? LitHtml`
                <button class="mode room ${used ? "on" : ""}"
                        @click=${() => this._toggleUsed()}
                        title=${used ? "Room in use (tap to mark unused)" : "Room unused (tap to mark in use)"}>
                  <ha-icon icon=${used ? "mdi:account-check" : "mdi:account-off"}></ha-icon>
                </button>
              `
            : ""}
        </div>

        ${this._presetMenuOpen
          ? LitHtml`
              <div class="preset-menu">
                ${this._presetOptions().map(
                  (opt) => LitHtml`
                    <button class="preset-opt ${opt === preset ? "sel" : ""}"
                            @click=${() => this._pickPreset(opt)}>
                      ${opt === "Auto" ? "Auto (algorithm)" : opt}
                      ${opt === preset ? LitHtml`<ha-icon icon="mdi:check"></ha-icon>` : ""}
                    </button>
                  `
                )}
              </div>
            `
          : ""}

        <div class="footer">
          <div class="dp">
            <span class="dp-val">${trvV != null ? trvV.toFixed(1) + "°" : "—"}</span>
            <span class="dp-lbl">TRV probe</span>
          </div>
          <div class="dp">
            <span class="dp-val">${action === "heating" ? "Open" : mode === "off" ? "Off" : "Idle"}</span>
            <span class="dp-lbl">Valve</span>
          </div>
        </div>
      </ha-card>
    `;
  }

}

// Styles as a plain string injected via a <style> block in render(). We avoid
// the static `css` tag entirely (its presence on the Lit prototype is
// version-dependent and threw a "Configuration error"). The card is a Lit
// component so this <style> is scoped to its shadow root.
HaNichThermostatCard.styleText = `
  ha-card {
    border-left: 4px solid var(--accent, #ef5350);
    border-radius: 18px;
    padding: 10px 8px 8px;
    color: var(--primary-text-color, #fff);
    /* Per-room "funk" hue: a subtle gradient tinted to the room's accent colour
       (set via the card's accent config), layered over the normal card bg. */
    background:
      linear-gradient(180deg,
        color-mix(in srgb, var(--accent, #ef5350) 14%, transparent),
        color-mix(in srgb, var(--accent, #ef5350) 4%, transparent)),
      var(--ha-card-background, var(--card-background-color, #1c1c1c));
    -webkit-tap-highlight-color: transparent;
  }
  .title { text-align: center; font-weight: 600; letter-spacing: .5px; padding-bottom: 4px; }
  .open-window {
    margin: 0 2px 6px; padding: 6px 10px; border-radius: 12px;
    background: rgba(3,169,244,0.18); color: #e1f5fe;
    font-size: 13px; font-weight: 600; text-align: center;
  }
  /* The dial + marker overlay share one centred, square box so the rotated
     orbit layers line up exactly with the SVG arc. */
  .dial-wrap { position: relative; width: 100%; max-width: 260px; margin: 0 auto; aspect-ratio: 1 / 1; }
  .dial {
    position: absolute; inset: 0; width: 100%; height: 100%;
    /* a vertical swipe scrolls the page; a tap/drag on the ring sets the
       temperature (the ring-hit + slop logic decides which) */
    touch-action: pan-y; cursor: pointer; outline: none;
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  .glow { pointer-events: none; transition: opacity .3s cubic-bezier(0.2,0,0,1); }
  /* Gradient arc: segments carry their own stroke colour (set in updated()). */
  .segs path { fill: none; stroke-width: 10; stroke-linecap: butt; }
  .big { font-size: 40px; font-weight: 300; text-anchor: middle; }

  /* Marker overlay — rotated-div orbits (same technique as material-thermostat-card). */
  .markers { position: absolute; inset: 0; pointer-events: none; }
  .orbit {
    position: absolute; inset: 0; transform-origin: 50% 50%;
    transition: transform .3s cubic-bezier(0.2,0,0,1);
  }
  /* A dot pinned at the top-centre of the orbit; rotating the orbit sweeps it
     around the ring. top matches the arc radius: r=92 of 220 viewBox =>
     (110-92)/220 = 8.2% from the top edge. */
  .o-dot {
    position: absolute; left: 50%; top: 8.2%;
    transform: translate(-50%, -50%); border-radius: 50%;
  }
  .o-dot.setpoint { width: 14px; height: 14px; background: #fff; box-shadow: 0 0 0 2px rgba(0,0,0,0.5); }
  .o-dot.current  { width: 12px; height: 12px; box-shadow: 0 0 0 2px rgba(0,0,0,0.25); }
  .o-label {
    position: absolute; left: 50%; top: 16%;
    font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.9); white-space: nowrap;
  }
  .deg { font-size: 16px; }
  .sub { font-size: 13px; fill: rgba(255,255,255,0.6); text-anchor: middle; }
  .bump { position: absolute; bottom: 14px; left: 0; right: 0; display: flex; gap: 28px; justify-content: center; }
  .bump button {
    width: 34px; height: 34px; border-radius: 50%; border: none;
    background: rgba(255,255,255,0.08); color: inherit; font-size: 20px; cursor: pointer;
  }
  .modes { display: flex; gap: 8px; justify-content: center; margin: 6px 0; }
  .mode {
    flex: 1; max-width: 120px; height: 42px; border: none; border-radius: 14px; cursor: pointer;
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7);
    display: flex; align-items: center; justify-content: center;
  }
  .mode.on { background: #4caf50; color: #fff; }
  .mode.boost.on { background: #ff9800; }
  .mode.room.on { background: #4caf50; color: #fff; }
  .mode.preset { gap: 6px; font-size: 13px; font-weight: 600; }
  .mode.preset.manual { background: #3f51b5; color: #fff; }
  .preset-lbl { line-height: 1; }
  .preset-menu {
    display: flex; flex-direction: column; gap: 4px; margin: 4px 2px 2px;
    background: rgba(0,0,0,0.25); border-radius: 12px; padding: 6px;
  }
  .preset-opt {
    display: flex; align-items: center; justify-content: space-between;
    border: none; border-radius: 10px; padding: 10px 12px; cursor: pointer;
    background: rgba(255,255,255,0.06); color: inherit; font-size: 14px;
  }
  .preset-opt.sel { background: #3f51b5; color: #fff; }
  .preset-opt ha-icon { --mdc-icon-size: 18px; }
  .footer { display: flex; gap: 8px; margin-top: 4px; }
  .dp {
    flex: 1; background: rgba(255,255,255,0.05); border-radius: 12px; padding: 6px 4px;
    text-align: center; display: flex; flex-direction: column;
  }
  .dp-val { font-weight: 600; }
  .dp-lbl { font-size: 11px; opacity: .6; }
  .warn { padding: 16px; color: var(--error-color, #f44); }
`;

customElements.define("ha-nich-thermostat-card", HaNichThermostatCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-nich-thermostat-card",
  name: "HA-Nich Thermostat Card",
  description: "Round thermostat with the room sensor as the big number and the TRV probe as a second data point.",
});
console.info("%c HA-NICH-THERMOSTAT-CARD v13 (colour-graded arc) ", "background:#ef5350;color:#fff;border-radius:4px;");
