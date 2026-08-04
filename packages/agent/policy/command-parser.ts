/**
 * A hand-written, quote-aware bash segmenter.
 *
 * The policy layer only needs two things from a command string: where the
 * command boundaries are, and what the leading word of each command is. That
 * is far less than a shell grammar, which is why this is a small scanner
 * rather than a parser dependency.
 *
 * What it does:
 * - splits on `&&`, `||`, `;`, `|`, `&` and newlines
 * - respects single and double quoting, so a separator inside quotes is text
 * - descends into `$(...)`, backticks, and the string argument of `sh -c`
 * - strips leading `VAR=value` assignments when identifying a command
 * - treats heredoc bodies as data while still evaluating the command that
 *   introduces them
 *
 * What it deliberately does not do: expansion, aliasing, or anything that
 * would require executing the shell. Dynamic construction (`eval`, base64
 * pipelines) defeats any static parse; the policy handles those with rules,
 * not with a cleverer parser.
 */

/**
 * One command found in the source, in the only two terms the policy layer uses:
 * the text a rule is matched against, and how deeply nested it was.
 */
export interface CommandSegment {
  /** The segment, trimmed, with leading `VAR=value` assignments removed. */
  text: string;
  /** Nesting depth: 0 for top level, +1 per substitution or `sh -c`. */
  depth: number;
}

export type ParseResult =
  | { ok: true; segments: CommandSegment[] }
  | { ok: false; reason: string };

const MAX_INPUT_LENGTH = 20_000;
const MAX_DEPTH = 8;

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_COMMANDS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);
const SHELL_COMMAND_FLAG_PATTERN = /^-[A-Za-z]*c$/;
const WHITESPACE_PATTERN = /\s/;
const DELIMITER_TERMINATOR_PATTERN = /[\s;&|<>()]/;

interface ShellWord {
  /** The word with quoting removed. */
  value: string;
  /** Offset of the word in the string it was split from. */
  start: number;
}

interface HeredocMarker {
  delimiter: string;
  strip: boolean;
}

interface ScanState {
  segments: CommandSegment[];
  failure: string | null;
}

/**
 * Split a segment into words, removing quoting. Offsets refer to `text` so a
 * caller can slice the original source (which keeps quoting intact).
 */
function splitWords(text: string): ShellWord[] {
  const words: ShellWord[] = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && WHITESPACE_PATTERN.test(text.charAt(index))) {
      index += 1;
    }
    if (index >= text.length) {
      break;
    }

    const start = index;
    let value = "";
    let quote: string | null = null;

    while (index < text.length) {
      const char = text.charAt(index);

      if (quote) {
        if (char === quote) {
          quote = null;
          index += 1;
          continue;
        }
        if (quote === '"' && char === "\\" && index + 1 < text.length) {
          value += text.charAt(index + 1);
          index += 2;
          continue;
        }
        value += char;
        index += 1;
        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        index += 1;
        continue;
      }
      if (char === "\\" && index + 1 < text.length) {
        value += text.charAt(index + 1);
        index += 2;
        continue;
      }
      if (WHITESPACE_PATTERN.test(char)) {
        break;
      }

      value += char;
      index += 1;
    }

    words.push({ value, start });
  }

  return words;
}

/** Index of the `)` closing a `$(` that opened at `openIndex`, or -1. */
function findSubstitutionEnd(source: string, openIndex: number): number {
  let depth = 1;
  let index = openIndex + 1;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source.charAt(index);

    if (quote) {
      if (quote === '"' && char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return -1;
}

/** Index of the backtick closing one that opened at `openIndex`, or -1. */
function findBacktickEnd(source: string, openIndex: number): number {
  let index = openIndex + 1;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      return index;
    }
    index += 1;
  }
  return -1;
}

/** Basename of a command word, so `/bin/sh` is recognised as `sh`. */
function commandBasename(command: string): string {
  const slash = command.lastIndexOf("/");
  return slash === -1 ? command : command.slice(slash + 1);
}

/** The script argument of a `sh -c` style invocation, if there is one. */
function shellStringArgument(words: ShellWord[]): string | null {
  const first = words[0];
  if (!first || !SHELL_COMMANDS.has(commandBasename(first.value))) {
    return null;
  }

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (!word) {
      continue;
    }
    if (SHELL_COMMAND_FLAG_PATTERN.test(word.value)) {
      return words[index + 1]?.value ?? null;
    }
  }

  return null;
}

function pushSegment(raw: string, depth: number, state: ScanState): void {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return;
  }

  const words = splitWords(trimmed);
  let index = 0;
  while (
    index < words.length &&
    ENV_ASSIGNMENT_PATTERN.test(words[index]?.value ?? "")
  ) {
    index += 1;
  }

  const first = words[index];
  const text = first ? trimmed.slice(first.start).trim() : trimmed;

  state.segments.push({ text, depth });

  const nestedScript = shellStringArgument(words.slice(index));
  if (nestedScript !== null && nestedScript !== "") {
    scan(nestedScript, depth + 1, state);
  }
}

function scan(source: string, depth: number, state: ScanState): void {
  if (state.failure) {
    return;
  }
  if (depth > MAX_DEPTH) {
    state.failure =
      "command nests shells or substitutions too deeply to analyse";
    return;
  }

  let buffer = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  let pendingSubstitutions: string[] = [];
  let heredocs: HeredocMarker[] = [];

  const flush = (): void => {
    pushSegment(buffer, depth, state);
    for (const nested of pendingSubstitutions) {
      scan(nested, depth + 1, state);
    }
    pendingSubstitutions = [];
    buffer = "";
  };

  const consumeSubstitution = (): boolean => {
    const end = findSubstitutionEnd(source, index + 1);
    if (end === -1) {
      state.failure = "command contains an unterminated command substitution";
      return false;
    }
    pendingSubstitutions.push(source.slice(index + 2, end));
    buffer += source.slice(index, end + 1);
    index = end + 1;
    return true;
  };

  const consumeBacktick = (): boolean => {
    const end = findBacktickEnd(source, index);
    if (end === -1) {
      state.failure = "command contains an unterminated backtick substitution";
      return false;
    }
    pendingSubstitutions.push(source.slice(index + 1, end));
    buffer += source.slice(index, end + 1);
    index = end + 1;
    return true;
  };

  const consumeHeredocHeader = (): void => {
    let cursor = index + 2;
    let strip = false;
    if (source.charAt(cursor) === "-") {
      strip = true;
      cursor += 1;
    }
    while (
      cursor < source.length &&
      source.charAt(cursor) !== "\n" &&
      WHITESPACE_PATTERN.test(source.charAt(cursor))
    ) {
      cursor += 1;
    }

    let delimiter = "";
    let delimiterQuote: string | null = null;
    while (cursor < source.length) {
      const char = source.charAt(cursor);
      if (delimiterQuote) {
        if (char === delimiterQuote) {
          delimiterQuote = null;
        } else {
          delimiter += char;
        }
        cursor += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        delimiterQuote = char;
        cursor += 1;
        continue;
      }
      if (DELIMITER_TERMINATOR_PATTERN.test(char)) {
        break;
      }
      delimiter += char;
      cursor += 1;
    }

    buffer += source.slice(index, cursor);
    index = cursor;
    if (delimiter !== "") {
      heredocs.push({ delimiter, strip });
    }
  };

  const consumeHeredocBodies = (): void => {
    for (const heredoc of heredocs) {
      while (index < source.length) {
        const newline = source.indexOf("\n", index);
        const line =
          newline === -1 ? source.slice(index) : source.slice(index, newline);
        index = newline === -1 ? source.length : newline + 1;
        const candidate = heredoc.strip ? line.trim() : line.trimEnd();
        if (candidate === heredoc.delimiter) {
          break;
        }
      }
    }
    heredocs = [];
  };

  while (index < source.length) {
    const char = source.charAt(index);

    if (quote === "'") {
      buffer += char;
      index += 1;
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (quote === '"') {
      if (char === "\\") {
        buffer += char + source.charAt(index + 1);
        index += 2;
        continue;
      }
      if (char === '"') {
        quote = null;
        buffer += char;
        index += 1;
        continue;
      }
      if (char === "$" && source.charAt(index + 1) === "(") {
        if (!consumeSubstitution()) {
          return;
        }
        continue;
      }
      if (char === "`") {
        if (!consumeBacktick()) {
          return;
        }
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "\\") {
      buffer += char + source.charAt(index + 1);
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      index += 1;
      continue;
    }
    if (char === "$" && source.charAt(index + 1) === "(") {
      if (!consumeSubstitution()) {
        return;
      }
      continue;
    }
    if (char === "`") {
      if (!consumeBacktick()) {
        return;
      }
      continue;
    }
    if (
      char === "<" &&
      source.charAt(index + 1) === "<" &&
      source.charAt(index + 2) !== "<"
    ) {
      consumeHeredocHeader();
      continue;
    }

    if (char === "\n") {
      flush();
      index += 1;
      if (heredocs.length > 0) {
        consumeHeredocBodies();
      }
      continue;
    }
    if (char === ";") {
      flush();
      index += 1;
      continue;
    }
    if (char === "|") {
      flush();
      index += source.charAt(index + 1) === "|" ? 2 : 1;
      continue;
    }
    if (char === "&") {
      // `&>` redirects output; `2>&1` duplicates a descriptor. Neither is a
      // command separator.
      if (source.charAt(index + 1) === ">" || buffer.trimEnd().endsWith(">")) {
        buffer += char;
        index += 1;
        continue;
      }
      flush();
      index += source.charAt(index + 1) === "&" ? 2 : 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  if (quote) {
    state.failure = "command contains an unterminated quote";
    return;
  }

  flush();
}

/**
 * Segment a bash command. Never throws: hostile or malformed input returns an
 * explicit unparseable result, which the policy resolves as `unknown`.
 */
export function parseCommand(command: string): ParseResult {
  if (command.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      reason: "command is longer than the policy parser will analyse",
    };
  }

  const state: ScanState = { segments: [], failure: null };

  try {
    scan(command, 0, state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `command could not be parsed: ${message}` };
  }

  if (state.failure) {
    return { ok: false, reason: state.failure };
  }

  return { ok: true, segments: state.segments };
}
