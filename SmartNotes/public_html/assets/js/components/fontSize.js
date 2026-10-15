// Text size stepper for the diagram editors (v1.20): A− [size] A+ and a reset to the automatic size.
import { html, icon } from '../core/dom.js';

export const FS_MIN = 8;
export const FS_MAX = 72;
const STEPS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72];

/** Next size up (dir 1) or down (dir -1) on the usual ladder. */
export function stepFs(cur, dir) {
  const v = +cur || 14;
  if (dir > 0) return STEPS.find((s) => s > v + 0.01) ?? FS_MAX;
  return [...STEPS].reverse().find((s) => s < v - 0.01) ?? FS_MIN;
}
export const clampFs = (v) => Math.max(FS_MIN, Math.min(FS_MAX, Math.round(+v * 2) / 2));

/** @param {number} size shown size (custom or automatic) @param {boolean} custom whether a size was chosen */
export function fsField(size, custom, label = 'Text size') {
  return html`<div class="field"><label>${label}${custom ? '' : html` <span class="subtle">(auto)</span>`}</label>
    <div class="fs-step" data-fs-box>
      <button type="button" class="btn sm icon" data-fs-step="-1" data-tip="Smaller" aria-label="Smaller text">${icon('a-arrow-down', 'sm')}</button>
      <input class="input sm" type="number" inputmode="decimal" min="${FS_MIN}" max="${FS_MAX}" step="1" value="${Math.round(size * 2) / 2}" data-fs aria-label="${label} in px">
      <button type="button" class="btn sm icon" data-fs-step="1" data-tip="Bigger" aria-label="Bigger text">${icon('a-arrow-up', 'sm')}</button>
      <button type="button" class="btn ghost sm" data-fs-reset ${custom ? '' : 'disabled'} data-tip="Back to the automatic size">Auto</button>
    </div></div>`;
}
