import "server-only";
import { z } from "zod";
import { linearGraphQL } from "./client";

const issueSchema = z.object({
  issue: z
    .object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      url: z.string(),
    })
    .nullable(),
});

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
};

export async function getLinearIssue(
  token: string,
  issueId: string,
): Promise<LinearIssue | null> {
  const execute = linearGraphQL(token);
  const data = await execute<z.infer<typeof issueSchema>>(
    `query Issue($id: String!) { issue(id: $id) { id identifier title description url } }`,
    { id: issueId },
  );
  if (!data) return null;
  const parsed = issueSchema.safeParse(data);
  if (!parsed.success || !parsed.data.issue) return null;
  return {
    ...parsed.data.issue,
    description: parsed.data.issue.description ?? null,
  };
}

export function buildIssueContextBlock(issue: LinearIssue): string {
  const desc =
    issue.description && issue.description.length > 0
      ? issue.description.length > 2000
        ? `${issue.description.slice(0, 2000)}\n\n[description truncated]`
        : issue.description
      : "";
  return `\n\n---\n**Linear Issue: ${issue.identifier} — ${issue.title}**\n${desc}\nIssue URL: ${issue.url}`;
}
