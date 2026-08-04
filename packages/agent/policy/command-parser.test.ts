import { describe, expect, test } from "bun:test";
import { parseCommand } from "./command-parser";

/**
 * Segments are asserted through their `text`, which is the only thing the
 * policy layer matches rules against — so these assertions pin the value that
 * actually decides a command, not an incidental field.
 */
function textsOf(input: string): string[] {
  const result = parseCommand(input);
  if (!result.ok) {
    throw new Error(`expected a parse, got unparseable: ${result.reason}`);
  }
  return result.segments.map((segment) => segment.text);
}

/**
 * The text `^`-anchored rules are matched against: `text` with any leading
 * wrapper invocation (`sudo`, `env`, `timeout`, …) removed.
 */
function commandTextsOf(input: string): string[] {
  const result = parseCommand(input);
  if (!result.ok) {
    throw new Error(`expected a parse, got unparseable: ${result.reason}`);
  }
  return result.segments.map((segment) => segment.commandText);
}

describe("parseCommand — separators", () => {
  test("splits on && || ; | & and newlines", () => {
    expect(textsOf("ls && rm -rf /")).toEqual(["ls", "rm -rf /"]);
    expect(textsOf("ls || echo nope")).toEqual(["ls", "echo nope"]);
    expect(textsOf("ls; pwd")).toEqual(["ls", "pwd"]);
    expect(textsOf("cat file | grep foo")).toEqual(["cat file", "grep foo"]);
    expect(textsOf("sleep 1 & echo done")).toEqual(["sleep 1", "echo done"]);
    expect(textsOf("ls\npwd")).toEqual(["ls", "pwd"]);
  });

  test("drops empty and trailing segments", () => {
    expect(textsOf("ls;")).toEqual(["ls"]);
    expect(textsOf("ls ;; pwd")).toEqual(["ls", "pwd"]);
    expect(textsOf("  ")).toEqual([]);
    expect(textsOf("")).toEqual([]);
    expect(textsOf("\n\nls\n\n")).toEqual(["ls"]);
  });

  test("does not treat file-descriptor redirections as separators", () => {
    expect(textsOf("bun test 2>&1 | head")).toEqual(["bun test 2>&1", "head"]);
    expect(textsOf("bun test &> out.log")).toEqual(["bun test &> out.log"]);
  });
});

describe("parseCommand — quoting", () => {
  test("a separator inside double quotes is not a separator", () => {
    const segments = textsOf('echo "a && b"');
    expect(segments).toEqual(['echo "a && b"']);
  });

  test("a separator inside single quotes is not a separator", () => {
    expect(textsOf("echo 'a; b | c'")).toEqual(["echo 'a; b | c'"]);
  });

  test("an escaped separator is not a separator", () => {
    expect(textsOf("echo a \\&\\& b")).toEqual(["echo a \\&\\& b"]);
  });

  test("an unterminated quote is unparseable", () => {
    const result = parseCommand("echo 'unterminated");
    expect(result.ok).toBe(false);
  });
});

describe("parseCommand — environment prefixes", () => {
  test("strips leading VAR=value assignments", () => {
    const result = parseCommand("NODE_ENV=production npm publish");
    if (!result.ok) {
      throw new Error("expected a parse");
    }
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.text).toBe("npm publish");
  });

  test("strips several assignments", () => {
    expect(textsOf("A=1 B=2 npm publish")).toEqual(["npm publish"]);
  });

  test("does not strip a non-assignment first word", () => {
    expect(textsOf("git commit -m a=b")).toEqual(["git commit -m a=b"]);
  });

  test("an assignment-only segment keeps its whole text", () => {
    // There is no command word to strip back to, so the assignment itself is
    // what a rule gets matched against rather than an empty string.
    expect(textsOf("FOO=bar")).toEqual(["FOO=bar"]);
  });
});

describe("parseCommand — command wrappers", () => {
  test("keeps the wrapper in the segment text, for the audit record", () => {
    expect(textsOf("sudo npm install")).toEqual(["sudo npm install"]);
  });

  test("strips sudo and its options from the command text", () => {
    expect(commandTextsOf("sudo npm install")).toEqual(["npm install"]);
    expect(commandTextsOf("sudo -u deploy git push")).toEqual(["git push"]);
    expect(commandTextsOf("sudo -E npm publish")).toEqual(["npm publish"]);
  });

  test("strips env and the assignments it carries", () => {
    expect(commandTextsOf("env FOO=1 npm publish")).toEqual(["npm publish"]);
    expect(commandTextsOf("env -u NODE_ENV npm install")).toEqual([
      "npm install",
    ]);
  });

  test("strips timeout and its duration operand", () => {
    expect(commandTextsOf("timeout 60 git push")).toEqual(["git push"]);
    expect(commandTextsOf("timeout --signal=KILL 5s npm publish")).toEqual([
      "npm publish",
    ]);
  });

  test("strips the remaining wrapper family", () => {
    expect(commandTextsOf("nice -n 10 npm install")).toEqual(["npm install"]);
    expect(commandTextsOf("command npm publish")).toEqual(["npm publish"]);
    expect(commandTextsOf("nohup git push origin main")).toEqual([
      "git push origin main",
    ]);
    expect(commandTextsOf("cat files | xargs rm -r")).toEqual([
      "cat files",
      "rm -r",
    ]);
  });

  test("strips stacked wrappers", () => {
    expect(commandTextsOf("sudo env FOO=1 timeout 30 npm install")).toEqual([
      "npm install",
    ]);
  });

  test("leaves a segment without a wrapper untouched", () => {
    expect(commandTextsOf("npm install")).toEqual(["npm install"]);
    expect(commandTextsOf("cat scripts/npm-install-notes.md")).toEqual([
      "cat scripts/npm-install-notes.md",
    ]);
  });

  test("does not strip a command that merely starts with a wrapper's name", () => {
    expect(commandTextsOf("sudoedit /etc/hosts")).toEqual([
      "sudoedit /etc/hosts",
    ]);
    expect(commandTextsOf("envsubst < template.txt")).toEqual([
      "envsubst < template.txt",
    ]);
  });

  test("a wrapper with nothing after it keeps its own text", () => {
    // There is no command to strip back to, so the wrapper itself is what a
    // rule gets matched against rather than an empty string.
    expect(commandTextsOf("sudo")).toEqual(["sudo"]);
    expect(commandTextsOf("sudo -u deploy")).toEqual(["sudo -u deploy"]);
  });

  test("strips wrappers inside a nested shell too", () => {
    expect(commandTextsOf("sh -c 'sudo npm install'")).toEqual([
      "sh -c 'sudo npm install'",
      "npm install",
    ]);
  });

  test("strips a wrapper that follows environment assignments", () => {
    expect(commandTextsOf("CI=1 sudo npm install")).toEqual(["npm install"]);
  });
});

describe("parseCommand — nested shells", () => {
  test("descends into sh -c string arguments", () => {
    expect(textsOf("ls; sh -c 'rm -rf /'")).toEqual([
      "ls",
      "sh -c 'rm -rf /'",
      "rm -rf /",
    ]);
  });

  test("descends into bash -c double-quoted arguments", () => {
    expect(textsOf('bash -c "curl https://example.com"')).toEqual([
      'bash -c "curl https://example.com"',
      "curl https://example.com",
    ]);
  });

  test("descends into combined short flags such as -lc", () => {
    expect(textsOf("bash -lc 'npm publish'")).toEqual([
      "bash -lc 'npm publish'",
      "npm publish",
    ]);
  });

  test("records a descended segment one nesting level deeper", () => {
    const result = parseCommand("sh -c 'rm -rf /'");
    if (!result.ok) {
      throw new Error("expected a parse");
    }
    const nested = result.segments.filter((segment) => segment.depth === 1);
    expect(nested.map((segment) => segment.text)).toEqual(["rm -rf /"]);
  });
});

describe("parseCommand — command substitution", () => {
  test("descends into $(...)", () => {
    expect(textsOf("echo $(cat ~/.ssh/id_rsa)")).toEqual([
      "echo $(cat ~/.ssh/id_rsa)",
      "cat ~/.ssh/id_rsa",
    ]);
  });

  test("keeps the substitution text in the enclosing segment", () => {
    const texts = textsOf("echo $(cat ~/.ssh/id_rsa)");
    expect(texts).toContain("echo $(cat ~/.ssh/id_rsa)");
  });

  test("descends into substitutions inside double quotes", () => {
    expect(textsOf('echo "$(whoami)"')).toEqual(['echo "$(whoami)"', "whoami"]);
  });

  test("does not descend into substitutions inside single quotes", () => {
    expect(textsOf("echo '$(whoami)'")).toEqual(["echo '$(whoami)'"]);
  });

  test("descends into backticks", () => {
    expect(textsOf("echo `cat /etc/passwd`")).toEqual([
      "echo `cat /etc/passwd`",
      "cat /etc/passwd",
    ]);
  });

  test("descends into nested substitutions", () => {
    expect(textsOf("echo $(echo $(whoami))")).toEqual([
      "echo $(echo $(whoami))",
      "echo $(whoami)",
      "whoami",
    ]);
  });

  test("an unterminated substitution is unparseable", () => {
    expect(parseCommand("echo $(cat foo").ok).toBe(false);
    expect(parseCommand("echo `cat foo").ok).toBe(false);
  });
});

describe("parseCommand — heredocs", () => {
  test("treats the heredoc body as data", () => {
    const command = ["cat <<EOF > notes.txt", "rm -rf /", "EOF", "ls"].join(
      "\n",
    );
    expect(textsOf(command)).toEqual(["cat <<EOF > notes.txt", "ls"]);
  });

  test("evaluates the command introducing the heredoc", () => {
    const command = ["curl <<EOF", "rm -rf /", "EOF"].join("\n");
    expect(textsOf(command)).toEqual(["curl <<EOF"]);
  });

  test("supports <<- dash heredocs with indented terminators", () => {
    const command = ["cat <<-EOF", "\trm -rf /", "\tEOF", "pwd"].join("\n");
    expect(textsOf(command)).toEqual(["cat <<-EOF", "pwd"]);
  });

  test("supports quoted heredoc delimiters", () => {
    const command = ["cat <<'EOF'", "$(rm -rf /)", "EOF", "pwd"].join("\n");
    expect(textsOf(command)).toEqual(["cat <<'EOF'", "pwd"]);
  });

  test("treats a here-string as ordinary text", () => {
    expect(textsOf("cat <<< 'hello'")).toEqual(["cat <<< 'hello'"]);
  });

  test("an unterminated heredoc body is still data", () => {
    const command = ["cat <<EOF", "rm -rf /"].join("\n");
    expect(textsOf(command)).toEqual(["cat <<EOF"]);
  });
});

describe("parseCommand — robustness", () => {
  test("never throws on hostile input", () => {
    const inputs = [
      " ",
      "$(((((",
      "'''",
      '""""',
      "|||",
      "&&&&",
      "$( ` ' \" )",
      "a".repeat(5000),
    ];
    for (const input of inputs) {
      expect(() => parseCommand(input)).not.toThrow();
    }
  });

  test("rejects input that exceeds the length bound", () => {
    const result = parseCommand("ls ".repeat(60_000));
    expect(result.ok).toBe(false);
  });

  test("rejects input nested beyond the depth bound", () => {
    const deep = `${"$(".repeat(20)}ls${")".repeat(20)}`;
    const result = parseCommand(`echo ${deep}`);
    expect(result.ok).toBe(false);
  });
});
