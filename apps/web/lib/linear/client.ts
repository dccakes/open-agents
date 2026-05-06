const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export function linearGraphQL(token: string) {
  return async function execute<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `Linear GraphQL request failed: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };

    if (json.errors && json.errors.length > 0) {
      throw new Error(
        `Linear GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
      );
    }

    return json.data as T;
  };
}
