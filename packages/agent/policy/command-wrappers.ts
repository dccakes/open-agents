/**
 * Identifying the command a segment actually runs.
 *
 * A rule like `^npm\s+install\b` anchors on the start of a segment, which is
 * the right shape — matching `npm install` anywhere in the text would gate
 * `cat notes-about-npm-install.md` and `echo "run npm install"`. But a shell
 * lets a command be introduced by a wrapper that takes it as an argument, and
 * `sudo npm install` then starts with `sudo`, not with `npm`.
 *
 * Before this module existed the anchored `ask` and `allow` rules were defeated
 * by any of them: `npm install` asked and `sudo npm install` was allowed. The
 * deny rules were not, because they carry a `(?:^|[\s;&|(])` prefix class — but
 * under a baseline whose `defaultAction` is `allow`, the `ask` class is where
 * most of the gating lives.
 *
 * So the parser records, per segment, the text with any leading wrapper removed
 * (`CommandSegment.commandText`), and rules are matched against that. The
 * wrapper stays in `CommandSegment.text`, which is what the audit record shows.
 *
 * The list is a closed set of known wrappers rather than a heuristic: only a
 * word that *is* one of these is stripped, so `sudoedit` and `envsubst` are
 * ordinary commands, and a command whose name merely contains a gated name is
 * untouched.
 */

/** An option that consumes the following word as its value. */
type ValueFlags = ReadonlySet<string>;

interface WrapperSpec {
  valueFlags: ValueFlags;
  /**
   * Whether the wrapper takes one positional operand of its own before the
   * command — `timeout 60 git push`.
   */
  operand?: boolean;
}

const NO_VALUE_FLAGS: ValueFlags = new Set<string>();

/**
 * Commands whose job is to run another command.
 *
 * Deliberately excludes `sh -c` / `bash -c`, which the parser descends into as
 * a nested script instead, and interpreters (`node -e`, `python -c`), whose
 * argument is program text the policy does not attempt to read.
 */
const COMMAND_WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map([
  [
    "sudo",
    {
      valueFlags: new Set([
        "-u",
        "-U",
        "-g",
        "-p",
        "-C",
        "-D",
        "-h",
        "-r",
        "-t",
        "--user",
        "--group",
        "--prompt",
        "--close-from",
        "--chdir",
        "--host",
        "--role",
        "--type",
      ]),
    },
  ],
  ["doas", { valueFlags: new Set(["-u", "-C"]) }],
  [
    "env",
    {
      valueFlags: new Set([
        "-u",
        "--unset",
        "-C",
        "--chdir",
        "-S",
        "--split-string",
      ]),
    },
  ],
  ["command", { valueFlags: NO_VALUE_FLAGS }],
  ["builtin", { valueFlags: NO_VALUE_FLAGS }],
  ["exec", { valueFlags: NO_VALUE_FLAGS }],
  ["nohup", { valueFlags: NO_VALUE_FLAGS }],
  ["setsid", { valueFlags: NO_VALUE_FLAGS }],
  [
    "stdbuf",
    {
      valueFlags: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
    },
  ],
  ["nice", { valueFlags: new Set(["-n", "--adjustment"]) }],
  ["ionice", { valueFlags: new Set(["-c", "-n", "-p", "-P"]) }],
  ["time", { valueFlags: new Set(["-o", "-f", "--output", "--format"]) }],
  [
    "timeout",
    {
      valueFlags: new Set(["-s", "--signal", "-k", "--kill-after"]),
      operand: true,
    },
  ],
  [
    "xargs",
    {
      valueFlags: new Set([
        "-I",
        "-i",
        "-n",
        "-L",
        "-P",
        "-s",
        "-d",
        "-E",
        "-a",
        "--replace",
        "--max-args",
        "--max-lines",
        "--max-procs",
        "--delimiter",
        "--eof",
        "--arg-file",
      ]),
    },
  ],
]);

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** One word of a segment, in the only term this module needs. */
interface WordLike {
  value: string;
}

/** Whether a word is a leading `VAR=value` assignment rather than a command. */
export function isEnvAssignment(word: string): boolean {
  return ENV_ASSIGNMENT_PATTERN.test(word);
}

/** Basename of a command word, so `/usr/bin/sh` is recognised as `sh`. */
export function commandBasename(command: string): string {
  const slash = command.lastIndexOf("/");
  return slash === -1 ? command : command.slice(slash + 1);
}

function isFlag(word: string): boolean {
  return word.startsWith("-") && word !== "-";
}

/**
 * Index of the first word after `wrapperIndex`'s own options and operand, or
 * `words.length` when the wrapper is the last thing in the segment.
 */
function skipWrapperArguments(
  words: readonly WordLike[],
  wrapperIndex: number,
  spec: WrapperSpec,
): number {
  let cursor = wrapperIndex + 1;
  let operandPending = spec.operand === true;

  while (cursor < words.length) {
    const value = words[cursor]?.value ?? "";

    if (isEnvAssignment(value)) {
      cursor += 1;
      continue;
    }
    if (value === "--") {
      cursor += 1;
      continue;
    }
    if (isFlag(value)) {
      cursor += spec.valueFlags.has(value) ? 2 : 1;
      continue;
    }
    if (operandPending) {
      operandPending = false;
      cursor += 1;
      continue;
    }
    break;
  }

  return cursor;
}

/**
 * Index of the word that names the command actually being run.
 *
 * Returns `startIndex` unchanged when the segment does not start with a
 * wrapper, and also when a wrapper has nothing after it — `sudo -u deploy` on
 * its own has no command to strip back to, and an empty match text would make
 * a patternless rule match a segment that runs nothing.
 */
export function skipCommandWrappers(
  words: readonly WordLike[],
  startIndex: number,
): number {
  let index = startIndex;
  // Bounded by the word count: each hop consumes at least one word, so this
  // cannot spin on a pathological segment.
  let remainingHops = words.length;

  while (remainingHops > 0) {
    remainingHops -= 1;
    const word = words[index];
    if (!word) {
      break;
    }

    const spec = COMMAND_WRAPPERS.get(commandBasename(word.value));
    if (!spec) {
      break;
    }

    const next = skipWrapperArguments(words, index, spec);
    if (next >= words.length) {
      // A wrapper and nothing else: keep the wrapper as the command.
      break;
    }
    index = next;
  }

  return index;
}
