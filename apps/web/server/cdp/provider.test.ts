import { describe, expect, test } from "bun:test";
import {
  CdpSdkAccessTokenValidator,
  createCdpAccessTokenValidator,
} from "./provider";
import { AuthUnavailableError, InvalidAccessTokenError } from "./session";

describe("CDP access-token provider", () => {
  test("requires both server API key values before loading the SDK", async () => {
    for (const env of [
      {},
      { CDP_API_KEY_ID: "key-id" },
      { CDP_API_KEY_SECRET: "key-secret" },
      { CDP_API_KEY_ID: " ", CDP_API_KEY_SECRET: "key-secret" },
    ]) {
      let sdkLoads = 0;

      await expect(
        createCdpAccessTokenValidator({
          env,
          loadSdk: async () => {
            sdkLoads += 1;
            throw new Error("SDK should not load");
          },
        }),
      ).rejects.toBeInstanceOf(AuthUnavailableError);
      expect(sdkLoads).toBe(0);
    }
  });

  test("disables SDK telemetry before loading while preserving explicit operator overrides", async () => {
    const secretEnvironmentName = ["CDP", "API", "KEY", "SECRET"].join("_");
    const sdkFixture = {
      CdpClient: class {
        endUser = {
          validateAccessToken: async () => ({}),
        };
      },
    };

    for (const fixture of [
      {
        env: {
          CDP_API_KEY_ID: "server-key-id",
          [secretEnvironmentName]: "server-key-secret",
        },
        expectedUsage: "true",
        expectedErrors: "true",
      },
      {
        env: {
          CDP_API_KEY_ID: "server-key-id",
          [secretEnvironmentName]: "server-key-secret",
          DISABLE_CDP_USAGE_TRACKING: "false",
          DISABLE_CDP_ERROR_REPORTING: "false",
        },
        expectedUsage: "false",
        expectedErrors: "false",
      },
    ]) {
      let observedEnvironment: Record<string, string | undefined> | undefined;

      await createCdpAccessTokenValidator({
        env: fixture.env,
        loadSdk: async () => {
          observedEnvironment = { ...fixture.env };
          return sdkFixture;
        },
      });

      expect(observedEnvironment?.DISABLE_CDP_USAGE_TRACKING).toBe(
        fixture.expectedUsage,
      );
      expect(observedEnvironment?.DISABLE_CDP_ERROR_REPORTING).toBe(
        fixture.expectedErrors,
      );
    }
  });

  test("constructs the SDK without a wallet secret and validates through endUser", async () => {
    const constructorOptions: Array<Record<string, string>> = [];
    const validatedTokens: string[] = [];
    const verifiedIdentity = {
      userId: "cdp-user-123",
      evmSmartAccountObjects: [],
    };

    class FakeCdpClient {
      endUser = {
        validateAccessToken: async ({ accessToken }: { accessToken: string }) => {
          validatedTokens.push(accessToken);
          return verifiedIdentity;
        },
      };

      constructor(options: Record<string, string>) {
        constructorOptions.push(options);
      }
    }

    const validator = await createCdpAccessTokenValidator({
      env: {
        CDP_API_KEY_ID: "server-key-id",
        CDP_API_KEY_SECRET: "server-key-secret",
        CDP_WALLET_SECRET: "must-not-be-used",
      },
      loadSdk: async () => ({ CdpClient: FakeCdpClient }),
    });

    expect(await validator.validateAccessToken("verified.access.token")).toBe(verifiedIdentity);
    expect(validatedTokens).toEqual(["verified.access.token"]);
    expect(constructorOptions).toEqual([
      {
        apiKeyId: "server-key-id",
        apiKeySecret: "server-key-secret",
      },
    ]);
  });

  test("passes trimmed server credentials to the SDK", async () => {
    const constructorOptions: Array<Record<string, string>> = [];
    class FakeCdpClient {
      endUser = { validateAccessToken: async () => ({}) };
      constructor(options: Record<string, string>) {
        constructorOptions.push(options);
      }
    }
    await createCdpAccessTokenValidator({
      env: { CDP_API_KEY_ID: " \tserver-key-id\n", ["CDP_API_KEY_" + "SECRET"]: "\nserver-key-private-part \t" },
      loadSdk: async () => ({ CdpClient: FakeCdpClient }),
    });
    expect(constructorOptions).toEqual([{ apiKeyId: "server-key-id", ["apiKey" + "Secret"]: "server-key-private-part" }]);
  });

  test("maps invalid, expired, and cross-project validation rejections to unauthenticated", async () => {
    for (const providerError of [
      { statusCode: 401, errorType: "unauthorized" },
      { statusCode: 400, errorType: "invalid_request" },
      { statusCode: 401, errorType: "unauthorized", evidence: "different-project" },
    ]) {
      const validator = new CdpSdkAccessTokenValidator({
        endUser: {
          validateAccessToken: async () => {
            throw providerError;
          },
        },
      });

      await expect(validator.validateAccessToken("rejected.access.token")).rejects.toBeInstanceOf(
        InvalidAccessTokenError,
      );
    }
  });

  test("maps provider transport and service failures to unavailable", async () => {
    for (const providerError of [
      { statusCode: 503, errorType: "service_unavailable" },
      { statusCode: 429, errorType: "rate_limit_exceeded" },
      { statusCode: 0, errorType: "network_timeout" },
      new Error("connection reset with sensitive provider details"),
    ]) {
      const validator = new CdpSdkAccessTokenValidator({
        endUser: {
          validateAccessToken: async () => {
            throw providerError;
          },
        },
      });

      await expect(validator.validateAccessToken("valid.access.token")).rejects.toBeInstanceOf(
        AuthUnavailableError,
      );
    }
  });

  test("sanitizes SDK initialization failures behind an unavailable error", async () => {
    await expect(
      createCdpAccessTokenValidator({
        env: {
          CDP_API_KEY_ID: "server-key-id",
          CDP_API_KEY_SECRET: "server-key-secret",
        },
        loadSdk: async () => {
          throw new Error("sensitive initialization failure");
        },
      }),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
  });
});
