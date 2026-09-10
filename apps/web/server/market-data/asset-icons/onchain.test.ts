import { describe, expect, spyOn, test } from "bun:test";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { encodeFunctionResult } from "viem";
import {
  CONTRACT_URI_ABI,
  ONCHAIN_ICON_RPC_BATCH_MAX,
  decodeContractUri,
  imageFromMetadataJson,
  readMetadataImage,
  readOnchainIconImages,
} from "./onchain";

const configuredIconAssets = [...stockAssets, ...cryptoAssets];
const amazon = stockAssets.find((asset) => asset.id === "amznc")!;
const bitcoin = cryptoAssets[0];

function encodedContractUri(uri: string) {
  return encodeFunctionResult({
    abi: CONTRACT_URI_ABI,
    functionName: "contractURI",
    result: uri,
  });
}

function assetKey(asset: { chainId: number; contractAddress: string }) {
  return `${asset.chainId}:${asset.contractAddress.toLowerCase()}`;
}

describe("onchain asset icons", () => {
  test("decodes contractURI and reads the metadata image", async () => {
    const uri = encodeFunctionResult({
      abi: CONTRACT_URI_ABI,
      functionName: "contractURI",
      result: "https://metadata.example.test/cbbtc.json",
    });
    expect(decodeContractUri(uri)).toBe("https://metadata.example.test/cbbtc.json");
    expect(imageFromMetadataJson({ image: "https://icons.example.test/btc.png" })).toBe(
      "https://icons.example.test/btc.png",
    );

    const imageUrl = await readMetadataImage(
      "https://metadata.example.test/cbbtc.json",
      async () =>
        new Response(JSON.stringify({ image: "ipfs://QmLogo/btc.png" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    expect(imageUrl).toBe("https://ipfs.io/ipfs/QmLogo/btc.png");
  });

  test("maps batch eth_call results onto configured stock/crypto ids", async () => {
    const uri = encodeFunctionResult({
      abi: CONTRACT_URI_ABI,
      functionName: "contractURI",
      result: "https://metadata.example.test/nvdac.json",
    });
    const images = await readOnchainIconImages({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (input, init) => {
        if (String(input) === "https://rpc.example.test") {
          const body = JSON.parse(String(init?.body)) as { id: number }[];
          return Response.json(
            body.map((request) =>
              request.id === 1 ? { id: 1, result: uri } : { id: request.id, result: "0x" },
            ),
          );
        }
        return new Response(
          JSON.stringify({ image: "https://icons.example.test/nvda.png" }),
        );
      },
    });

    expect(images.get("8453:0xb20000000000000000000078ee7ce2fe4908108c")).toBe(
      "https://icons.example.test/nvda.png",
    );
  });

  test("falls closed when RPC or metadata is missing", async () => {
    const images = await readOnchainIconImages({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    expect(images.size).toBe(0);
    expect(await readMetadataImage("https://metadata.example.test/missing.json", async () => {
      throw new Error("network");
    })).toBeNull();
  });

  test("chunks contractURI eth_calls at the public Base batch limit", async () => {
    const batches: Array<Array<{ id: number; method: string }>> = [];
    const images = await readOnchainIconImages({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (input, init) => {
        if (String(input) === "https://rpc.example.test") {
          const body = JSON.parse(String(init?.body)) as Array<{
            id: number;
            method: string;
          }>;
          expect(Array.isArray(body)).toBe(true);
          expect(body.length).toBeGreaterThan(0);
          expect(body.length).toBeLessThanOrEqual(ONCHAIN_ICON_RPC_BATCH_MAX);
          batches.push(body);
          return Response.json(
            body.map((request) => {
              const asset = configuredIconAssets[request.id - 1];
              return {
                id: request.id,
                result: encodedContractUri(
                  `https://metadata.example.test/${asset.id}.json`,
                ),
              };
            }),
          );
        }
        const url = String(input);
        const id = configuredIconAssets.find(
          (asset) => url === `https://metadata.example.test/${asset.id}.json`,
        )?.id;
        return Response.json({
          image: `https://icons.example.test/${id ?? "unknown"}.png`,
        });
      },
    });

    expect(ONCHAIN_ICON_RPC_BATCH_MAX).toBe(10);
    expect(configuredIconAssets.length).toBeGreaterThan(ONCHAIN_ICON_RPC_BATCH_MAX);
    expect(batches).toHaveLength(
      Math.ceil(configuredIconAssets.length / ONCHAIN_ICON_RPC_BATCH_MAX),
    );
    expect(batches.every((batch) => batch.length <= ONCHAIN_ICON_RPC_BATCH_MAX)).toBe(
      true,
    );
    expect(batches.flat()).toHaveLength(configuredIconAssets.length);
    expect(batches[0]).toHaveLength(ONCHAIN_ICON_RPC_BATCH_MAX);
    expect(images.get(assetKey(amazon))).toBe("https://icons.example.test/amznc.png");
    expect(images.get(assetKey(bitcoin))).toBe(
      "https://icons.example.test/cbbtc.png",
    );
  });

  test("keeps later batches when one payload is a JSON-RPC error object", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const images = await readOnchainIconImages({
        rpcUrl: "https://rpc.example.test",
        fetchImpl: async (input, init) => {
          if (String(input) === "https://rpc.example.test") {
            const body = JSON.parse(String(init?.body)) as { id: number }[];
            if (body.some((request) => request.id === 1)) {
              return Response.json({
                jsonrpc: "2.0",
                error: {
                  code: -32014,
                  message: "maximum 10 calls in 1 batch",
                },
              });
            }
            return Response.json(
              body.map((request) => ({
                id: request.id,
                result: encodedContractUri(
                  `https://metadata.example.test/${configuredIconAssets[request.id - 1].id}.json`,
                ),
              })),
            );
          }
          return Response.json({
            image: "https://icons.example.test/cbbtc.png",
          });
        },
      });

      expect(images.has(assetKey(amazon))).toBe(false);
      expect(images.get(assetKey(bitcoin))).toBe(
        "https://icons.example.test/cbbtc.png",
      );
      expect(warn).toHaveBeenCalledWith("[asset-icons] Base RPC batch rejected", {
        code: -32014,
        message: "maximum 10 calls in 1 batch",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
