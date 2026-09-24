export type Variant = "256" | "384" | "640";
export interface ThermalVariant {
  resolution: [number, number];
  netdMk: number;
  lenses: Record<string, [number, number]>;
  defaultLens: string;
}
export const SC_IT6420_HB_V2: {
  model: string; vendor: string; datasheetRev: string;
  thermal: Record<Variant, ThermalVariant>;
  sensor: string; spectralUm: [number, number]; focus: string;
  visible: { sensor: string; resolution: [number, number]; lenses: string[]; irRangeM: number };
  measurement: {
    rangesC: [number, number][]; accuracy: string; accuracyC: number;
    maxPoints: number; maxAreas: number; maxLines: number;
    emissivity: [number, number]; corrections: string[]; alarms: string[];
  };
  environment: { workingC: [number, number]; humidity: string; protection: string };
  power: { supply: string; maxW: number };
  network: {
    protocols: string[]; compatibility: string[]; temperatureOutput: string[];
    ethernet: string; serial: string; alarmIO: string; security: string[];
  };
  video: string;
  physical: { material: string; dimensionsMm: [number, number, number]; maxKg: number };
};
export type TargetKey = "nostril" | "eye";
export const TARGETS: Record<TargetKey, { cm: number; label: string }>;
export const MIN_PX: Record<TargetKey, number>;
export interface Footprint { fovH: number; fovV: number; widthM: number; heightM: number; pxPerCm: number }
export interface TargetAssessment {
  label: string; cm: number; px: number; need: number;
  verdict: "good" | "marginal" | "insufficient"; maxDistanceM: number;
}
export function variants(): Variant[];
export function lensesFor(variant: string): string[];
export function thermalFootprint(variant: string, lens: string, distanceM: number): Footprint | null;
export function pixelsOnTarget(variant: string, lens: string, distanceM: number, targetCm: number): number;
export function maxDistanceFor(variant: string, lens: string, targetCm: number, minPx: number): number;
export function assessOptics(variant: string, lens: string, distanceM: number):
  { footprint: Footprint; targets: Record<TargetKey, TargetAssessment> } | null;
export function validateCameraModel(c: {
  variant: string; thermalLens: string; visibleLens: string; emissivity: number; distanceM: number;
}): string[];
