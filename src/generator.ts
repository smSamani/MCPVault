import { randomInt } from "node:crypto";

export interface GenerateOptions {
  length?: number;
  lowercase?: boolean;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
  /** Override the symbol alphabet (e.g. for sites that only allow a few). */
  symbolSet?: string;
}

export const DEFAULT_LENGTH = 24;
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 256;

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
// No quotes, backslash, backtick, space or angle brackets: these break
// many signup forms and shell/JSON contexts.
export const DEFAULT_SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/~";
const AMBIGUOUS = new Set("Il1O0o|`'\"");

export interface GeneratedPassword {
  password: string;
  length: number;
  entropyBits: number;
}

/**
 * Generate a password with the OS CSPRNG (crypto.randomInt is unbiased).
 * Every enabled character class is guaranteed to appear; candidates that
 * miss a class are rejected and regenerated, so no position is predictable.
 */
export function generatePassword(opts: GenerateOptions = {}): GeneratedPassword {
  const length = opts.length ?? DEFAULT_LENGTH;
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new Error(`length must be an integer between ${MIN_LENGTH} and ${MAX_LENGTH}`);
  }
  const strip = (s: string) => (opts.excludeAmbiguous ? [...s].filter((c) => !AMBIGUOUS.has(c)).join("") : s);
  const classes: string[] = [];
  if (opts.lowercase ?? true) classes.push(strip(LOWER));
  if (opts.uppercase ?? true) classes.push(strip(UPPER));
  if (opts.digits ?? true) classes.push(strip(DIGITS));
  if (opts.symbols ?? true) {
    const sym = strip([...new Set(opts.symbolSet ?? DEFAULT_SYMBOLS)].filter((c) => c > " " && c <= "~").join(""));
    if (sym.length > 0) classes.push(sym);
  }
  const nonEmpty = classes.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) throw new Error("at least one character class must be enabled");
  if (nonEmpty.length > length) throw new Error("length is too short for the enabled character classes");
  const alphabet = [...new Set(nonEmpty.join(""))];

  for (let attempt = 0; attempt < 1000; attempt++) {
    const chars: string[] = new Array(length);
    for (let i = 0; i < length; i++) chars[i] = alphabet[randomInt(alphabet.length)]!;
    if (nonEmpty.every((cls) => chars.some((c) => cls.includes(c)))) {
      return { password: chars.join(""), length, entropyBits: Math.floor(length * Math.log2(alphabet.length)) };
    }
  }
  throw new Error("failed to generate password");
}
