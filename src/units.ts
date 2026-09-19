// A4 physical dimensions in centimeters
export const A4_WIDTH_CM = 21.0
export const A4_HEIGHT_CM = 29.7

// A4 base document points/pixels
export const A4_BASE_WIDTH = 595
export const A4_BASE_HEIGHT = 841.5

// Fixed conversion factors: independent of screen DPI or responsive zoom
// 595 px / 21.0 cm = 28.333333333333332 px/cm
// 841.5 px / 29.7 cm = 28.333333333333332 px/cm (exact 1:1 square aspect ratio)
export const PX_PER_CM = A4_BASE_WIDTH / A4_WIDTH_CM
export const CM_PER_PX = A4_WIDTH_CM / A4_BASE_WIDTH

export function pxToCm(px: number): number {
  return px * CM_PER_PX
}

export function cmToPx(cm: number): number {
  return cm * PX_PER_CM
}

export function formatCm(cm: number): string {
  return cm.toFixed(1)
}
