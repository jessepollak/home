import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createIdrxRequestHeaders, createIdrxSignature } from "./idrx-hmac";

const SECRET = Buffer.from("idrx-test-secret").toString("base64");
const URL = "https://api.idrx.co/transaction/mint-request";
const TIMESTAMP = "1700000000000";
const BODY =
  '{"toBeMinted":"20000","destinationWalletAddress":"0x1111111111111111111111111111111111111111","networkChainId":"8453","requestType":"idrx","expiryPeriod":60,"paymentMethod":"va","channelId":"MANDIRI"}';

describe("IDRX HMAC signature", () => {
  test("matches the published timestamp + method + url + body helper", () => {
    const expected = createHmac("sha256", Buffer.from(SECRET, "base64"))
      .update(TIMESTAMP)
      .update("POST")
      .update(URL)
      .update(BODY)
      .digest("base64url");

    expect(createIdrxSignature({
      method: "POST",
      url: URL,
      body: BODY,
      timestamp: TIMESTAMP,
      secretKey: SECRET,
    })).toBe(expected);
    expect(expected).toBe("TIiWEY8ESCqHQPv9XL0zEmpSYU7kdePmhIetvKvuxn8");
  });

  test("omits an empty body from the MAC and sets the documented headers", () => {
    const headers = createIdrxRequestHeaders({
      apiKey: "public-key",
      secretKey: SECRET,
      method: "GET",
      url: "https://api.idrx.co/transaction/user-transaction-history",
      body: "",
      timestamp: TIMESTAMP,
    });

    expect(headers["idrx-api-key"]).toBe("public-key");
    expect(headers["idrx-api-ts"]).toBe(TIMESTAMP);
    expect(headers["User-Agent"]).toBe("home/idrx-mint");
    expect(headers["idrx-api-sig"]).toBe(
      createHmac("sha256", Buffer.from(SECRET, "base64"))
        .update(TIMESTAMP)
        .update("GET")
        .update("https://api.idrx.co/transaction/user-transaction-history")
        .digest("base64url"),
    );
  });
});
