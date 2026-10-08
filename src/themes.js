/**
 * Central appearance themes.
 * Add a key here to expose it in the theme menu — the renderer reads these
 * values and does not hard-code a palette.
 *
 * hue: 0–360, saturation / lightness: 0–100.
 */

export const themes = {
  monochrome: {
    background: '#000000',
    hue: 0,
    saturation: 0,
    minLightness: 8,
    maxLightness: 92,
    pipOff: '#000000',
    pipOn: '#ffffff'
  }
};

export function themeIds() {
  return Object.keys(themes);
}

export function getTheme(id) {
  return themes[id] || themes.monochrome;
}

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  if (sat === 0) return [lig, lig, lig];
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = lig - c / 2;
  return [r + m, g + m, b + m];
}

/**
 * Persistent body color. `t` is a stable 0–1 rank for this die so sliders
 * remap lightness without reshuffling the field.
 */
export function bodyColor(theme, t, minLightness, maxLightness) {
  const lo = Math.min(minLightness, maxLightness) / 100;
  const hi = Math.max(minLightness, maxLightness) / 100;
  const l = lo + (hi - lo) * t;
  return hslToRgb(theme.hue, theme.saturation / 100, l);
}
