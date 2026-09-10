import { beforeEach, describe, expect, mock, test } from "bun:test";

let ownedChats: Array<{ id: string }> = [{ id: "chat-1" }, { id: "chat-2" }];
let deleteCalls = 0;

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => ownedChats,
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          deleteCalls += 1;
          return ownedChats.map((chat) => ({ id: `share-${chat.id}` }));
        },
      }),
    }),
  },
}));

const modulePromise = import("@/lib/db/user-shares");

beforeEach(() => {
  ownedChats = [{ id: "chat-1" }, { id: "chat-2" }];
  deleteCalls = 0;
});

describe("revokeSharesForUser", () => {
  test("deletes every share on a chat the user owns", async () => {
    const { revokeSharesForUser } = await modulePromise;

    expect(await revokeSharesForUser("u1")).toBe(2);
    expect(deleteCalls).toBe(1);
  });

  test("issues no delete when the user owns no chats", async () => {
    ownedChats = [];
    const { revokeSharesForUser } = await modulePromise;

    expect(await revokeSharesForUser("u1")).toBe(0);
    expect(deleteCalls).toBe(0);
  });
});
