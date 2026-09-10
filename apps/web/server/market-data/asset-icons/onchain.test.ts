import { describe, expect, test } from "bun:test";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { encodeFunctionResult } from "viem";
import {
  CONTRACT_URI_ABI,
  ONCHAIN_ICON_RPC_BATCH_MAX,
  decodeContractUri,
  imageFromMetadataJson,
  readContractUrisInBatches,
  readMetadataImage,
  readOnchainIconImages,
  type OnchainIconRpcRequest,
} from "./onchain";

const configuredIconAssets = [...stockAssets, ...cryptoAssets];
const rpcUrl = "https://rpc.example.test";

function encodedContractUri(uri: string) {
  return encodeFunctionResult({
    abi: CONTRACT_URI_ABI,
    functionName: "contractURI",
    result: uri,
  });
}

function requests(count: number): OnchainIconRpcRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    jsonrpc: "2.0" as const,
    id: index + 1,
    method: "eth_call" as const,
    params: [
      {
        to: "0xb200000000000000000000000000000000000001" as const,
        data: "0xe8a3d485" as const,
      },
      "latest" as const,
    ],
  }));
}

function rpcSuccess(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    result: encodedContractUri(`https://metadata.example.test/${id}.json`),
  };
}

function rpcError(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: "execution failed" },
  };
}

function assetKey(asset: { chainId: number; contractAddress: string }) {
  return `${asset.chainId}:${asset.contractAddress.toLowerCase()}`;
}

describe("onchain asset icons", () => {
  test("decodes contractURI and reads the metadata image", async () => {
    const uri = encodedContractUri("https://metadata.example.test/cbbtc.json");
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

  for (const count of [0, 1, 10, 11, 37]) {
    test(`chunks and deterministically merges ${count} contractURI calls`, async () => {
      const batches: number[][] = [];
      const controller = new AbortController();
      const uris = await readContractUrisInBatches({
        requests: requests(count),
        rpcUrl,
        signal: controller.signal,
        fetchImpl: async (_input, init) => {
          const batch = JSON.parse(String(init?.body)) as OnchainIconRpcRequest[];
          batches.push(batch.map(({ id }) => id));
          return Response.json(batch.map(({ id }) => rpcSuccess(id)).reverse());
        },
      });

      const expectedIds = Array.from({ length: count }, (_, index) => index + 1);
      expect(batches.map((batch) => batch.length)).toEqual(
        Array.from(
          { length: Math.ceil(count / ONCHAIN_ICON_RPC_BATCH_MAX) },
          (_, index) =>
            Math.min(
              ONCHAIN_ICON_RPC_BATCH_MAX,
              count - index * ONCHAIN_ICON_RPC_BATCH_MAX,
            ),
        ),
      );
      expect(batches.flat()).toEqual(expectedIds);
      expect(new Set(batches.flat()).size).toBe(count);
      expect([...uris.keys()]).toEqual(expectedIds);
      expect([...uris.values()]).toEqual(
        expectedIds.map((id) => `https://metadata.example.test/${id}.json`),
      );
    });
  }

  test("keeps successful chunks when another chunk fails", async () => {
    const called: number[][] = [];
    const uris = await readContractUrisInBatches({
      requests: requests(25),
      rpcUrl,
      signal: new AbortController().signal,
      fetchImpl: async (_input, init) => {
        const batch = JSON.parse(String(init?.body)) as OnchainIconRpcRequest[];
        called.push(batch.map(({ id }) => id));
        if (batch[0]?.id === 11) throw new Error("network");
        return Response.json(batch.map(({ id }) => rpcSuccess(id)));
      },
    });

    expect(called.map((batch) => batch.length)).toEqual([10, 10, 5]);
    expect([...uris.keys()]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25,
    ]);
  });

  test("returns completed chunks and stops scheduling after timeout", async () => {
    const controller = new AbortController();
    const called: number[][] = [];
    const result = readContractUrisInBatches({
      requests: requests(25),
      rpcUrl,
      signal: controller.signal,
      fetchImpl: async (_input, init) => {
        const batch = JSON.parse(String(init?.body)) as OnchainIconRpcRequest[];
        called.push(batch.map(({ id }) => id));
        if (batch[0]?.id === 1) {
          return Response.json(batch.map(({ id }) => rpcSuccess(id)));
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    setTimeout(() => controller.abort(), 1);

    const uris = await result;
    expect(called.map((batch) => batch[0])).toEqual([1, 11]);
    expect([...uris.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("isolates malformed chunk payloads without inventing values", async () => {
    const uris = await readContractUrisInBatches({
      requests: requests(31),
      rpcUrl,
      signal: new AbortController().signal,
      fetchImpl: async (_input, init) => {
        const batch = JSON.parse(String(init?.body)) as OnchainIconRpcRequest[];
        if (batch[0]?.id === 11) {
          return new Response("{not-json", {
            headers: { "content-type": "application/json" },
          });
        }
        if (batch[0]?.id === 21) {
          return Response.json({
            jsonrpc: "2.0",
            error: { code: -32014, message: "maximum 10 calls in 1 batch" },
          });
        }
        return Response.json([
          ...batch.map(({ id }) => rpcSuccess(id)),
          rpcSuccess(999),
        ]);
      },
    });

    expect([...uris.keys()]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 31,
    ]);
    expect(uris.has(999)).toBe(false);
  });

  test("fails a duplicated response id closed", async () => {
    const uris = await readContractUrisInBatches({
      requests: requests(2),
      rpcUrl,
      signal: new AbortController().signal,
      fetchImpl: async () =>
        Response.json([rpcSuccess(1), rpcSuccess(2), rpcSuccess(1)]),
    });

    expect([...uris.keys()]).toEqual([2]);
  });

  test("fails a valid response followed by an error for the same id closed", async () => {
    const uris = await readContractUrisInBatches({
      requests: requests(2),
      rpcUrl,
      signal: new AbortController().signal,
      fetchImpl: async () =>
        Response.json([rpcSuccess(1), rpcSuccess(2), rpcError(1)]),
    });

    expect([...uris.keys()]).toEqual([2]);
  });

  test("fails an error followed by a valid response for the same id closed", async () => {
    const uris = await readContractUrisInBatches({
      requests: requests(2),
      rpcUrl,
      signal: new AbortController().signal,
      fetchImpl: async () =>
        Response.json([rpcError(1), rpcSuccess(2), rpcSuccess(1)]),
    });

    expect([...uris.keys()]).toEqual([2]);
  });

  test("resolves Amazon and every configured stock without reordering assets", async () => {
    const rpcBatches: string[][] = [];
    const metadataCalls: string[] = [];
    const images = await readOnchainIconImages({
      rpcUrl,
      fetchImpl: async (input, init) => {
        if (String(input) === rpcUrl) {
          const batch = JSON.parse(String(init?.body)) as OnchainIconRpcRequest[];
          rpcBatches.push(
            batch.map(({ params }) => params[0].to.toLowerCase()),
          );
          return Response.json(
            batch
              .map((request) => {
                const asset = configuredIconAssets.find(
                  ({ contractAddress }) =>
                    contractAddress.toLowerCase() ===
                    request.params[0].to.toLowerCase(),
                );
                if (!asset) throw new Error("unexpected contract");
                return {
                  jsonrpc: "2.0",
                  id: request.id,
                  result: encodedContractUri(
                    `https://metadata.example.test/${asset.id}.json`,
                  ),
                };
              })
              .reverse(),
          );
        }

        const url = String(input);
        metadataCalls.push(url);
        const id = url.split("/").at(-1)?.replace(".json", "");
        const assetIndex = configuredIconAssets.findIndex((asset) => asset.id === id);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, configuredIconAssets.length - assetIndex)),
        );
        return Response.json({ image: `https://icons.example.test/${id}.png` });
      },
    });

    const configuredAddresses = configuredIconAssets.map(({ contractAddress }) =>
      contractAddress.toLowerCase(),
    );
    expect(rpcBatches.map((batch) => batch.length)).toEqual([10, 5]);
    expect(rpcBatches.flat()).toEqual(configuredAddresses);
    expect(new Set(rpcBatches.flat()).size).toBe(configuredIconAssets.length);
    expect(metadataCalls).toHaveLength(configuredIconAssets.length);
    expect([...images.keys()]).toEqual(configuredIconAssets.map(assetKey));
    for (const stock of stockAssets) {
      expect(images.get(assetKey(stock))).toBe(
        `https://icons.example.test/${stock.id}.png`,
      );
    }
    const amazon = stockAssets.find(({ id }) => id === "amznc");
    expect(amazon).toBeDefined();
    expect(images.get(assetKey(amazon!))).toBe(
      "https://icons.example.test/amznc.png",
    );
  });

  test("falls closed when RPC or metadata is missing", async () => {
    const images = await readOnchainIconImages({
      rpcUrl,
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    expect(images.size).toBe(0);
    expect(
      await readMetadataImage(
        "https://metadata.example.test/missing.json",
        async () => {
          throw new Error("network");
        },
      ),
    ).toBeNull();
  });
});
