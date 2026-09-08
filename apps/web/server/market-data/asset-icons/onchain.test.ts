import { describe, expect, test } from "bun:test";
import { encodeFunctionResult } from "viem";
import {
  CONTRACT_URI_ABI,
  decodeContractUri,
  imageFromMetadataJson,
  readMetadataImage,
  readOnchainIconImages,
} from "./onchain";

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
});
