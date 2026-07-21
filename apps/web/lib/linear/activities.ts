import "server-only";
import { linearGraphQL } from "./client";

export async function postLinearThoughtActivity(
  token: string,
  agentSessionId: string,
  text: string,
): Promise<void> {
  const execute = linearGraphQL(token);
  await execute(
    `mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
      agentActivityCreate(input: $input) { success }
    }`,
    { input: { agentSessionId, type: "thinking", body: text } },
  );
}

export async function postLinearComment(
  token: string,
  issueId: string,
  body: string,
): Promise<void> {
  const execute = linearGraphQL(token);
  await execute(
    `mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId, body } },
  );
}
