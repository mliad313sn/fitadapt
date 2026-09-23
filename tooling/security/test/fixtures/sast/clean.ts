// Ordinary code: the SAST gate must accept it.
export function total(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}
export const isUuid = (value: string) => /^[0-9a-f-]{36}$/.test(value);
