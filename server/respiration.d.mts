export const RESP_MIN_PERIODICITY: number;
export const RESP_SUBHARMONIC_RATIO: number;
export function detrend(samples: number[]): number[];
export function computeRespRate(samples: number[], fs: number): { bpm: number | null; periodicity: number };
