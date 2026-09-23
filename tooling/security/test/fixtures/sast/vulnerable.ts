// Deliberately vulnerable code: the SAST gate must reject every line below.
import { exec } from 'node:child_process';

export function list(dir: string) {
  exec(`ls ${dir}`);
}
export function calculate(expression: string) {
  return eval(expression);
}
export const build = new Function('a', 'return a');
export const matcher = (pattern: string) => new RegExp(pattern);
export const slow = /(a+)+$/;
export function later() {
  setTimeout('document.title = "x"', 10);
}
