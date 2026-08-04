import * as path from "path";
import { isPathWithinDirectory } from "./utils";

/**
 * Resolution of the bash tool's `cwd` argument.
 *
 * Its own module because it is its own rule: the tool documents `cwd` as a
 * workspace-relative subdirectory, but the schema accepts any string, so an
 * absolute path or a `../..` traversal used to select a directory outside the
 * workspace with nothing checking it. Containment is decided here; the tool
 * turns the failure into a refusal.
 */

export type BashWorkingDirectory =
  | { ok: true; workingDir: string }
  | { ok: false; reason: string };

export function resolveBashWorkingDirectory(params: {
  cwd?: string;
  workingDirectory: string;
}): BashWorkingDirectory {
  const { cwd, workingDirectory } = params;

  if (!cwd) {
    return { ok: true, workingDir: workingDirectory };
  }

  const resolved = path.isAbsolute(cwd)
    ? path.resolve(cwd)
    : path.resolve(workingDirectory, cwd);

  if (!isPathWithinDirectory(resolved, workingDirectory)) {
    return {
      ok: false,
      reason: `The working directory "${cwd}" resolves outside the workspace (${workingDirectory}). Use a workspace-relative subdirectory.`,
    };
  }

  return { ok: true, workingDir: resolved };
}
