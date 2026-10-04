import { expect, test } from "bun:test";
import { createTransferRecipientNameHandler } from "@/server/transfers/handlers";
import { readTransferRecipientNameResponse } from "@/shared/transfers/contracts/recipients";

const address = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const session = {
  user: { subject: "owner-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const request = () => new Request("https://home.test/api/transfers/recipient-name?name=EXAMPLE.BASE.ETH");

test("recipient-name GET handler output round-trips through its normalized versioned parser", async () => {
  const GET = createTransferRecipientNameHandler({
    authorize: async () => Response.json(session),
    resolve: async () => address,
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ version: 1, name: "example.base.eth", address });
  expect(readTransferRecipientNameResponse(body)).toEqual({ name: "example.base.eth", address });
});

test.each(["0x123", "0x0000000000000000000000000000000000000000"])(
  "malformed resolved recipient %s never becomes a parsed recipient", async (resolved) => {
    const GET = createTransferRecipientNameHandler({
      authorize: async () => Response.json(session), resolve: async () => resolved,
    });
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(readTransferRecipientNameResponse(await response.json())).toBeNull();
  },
);

test("a rejected session cannot resolve or return a recipient", async () => {
  let resolutions = 0;
  const GET = createTransferRecipientNameHandler({
    authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }),
    resolve: async () => { resolutions++; return address; },
  });
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(readTransferRecipientNameResponse(await response.json())).toBeNull();
  expect(resolutions).toBe(0);
});
