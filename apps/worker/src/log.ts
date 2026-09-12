const GREY = "\x1b[90m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function stamp(): string {
  return `${GREY}${new Date().toISOString().slice(11, 19)}${RESET}`;
}

export const log = {
  info: (msg: string) => console.log(`${stamp()} ${msg}`),
  ok: (msg: string) => console.log(`${stamp()} ${GREEN}${msg}${RESET}`),
  warn: (msg: string) => console.warn(`${stamp()} ${YELLOW}warn${RESET} ${msg}`),
  error: (msg: string) => console.error(`${stamp()} ${RED}fail${RESET} ${msg}`),
  step: (msg: string) => console.log(`${stamp()} ${GREY}·${RESET} ${msg}`),
};
