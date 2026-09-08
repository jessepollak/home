import { describe, expect, test } from "bun:test";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { encodeFunctionResult } from "viem";
import { CONTRACT_URI_ABI } from "./onchain";
import { createAssetIconResolver, emptyAssetIconMap } from "./resolve";

const nvidia = stockAssets[0];
const bitcoin = cryptoAssets[0];

describe("asset icon resolver", () => {
  test("prefers onchain metadata over Codex token images", async () => {
    const uri = encodeFunctionResult({
      abi: CONTRACT_URI_ABI,
      functionName: "contractURI",
      result: "https://metadata.example.test/nvdac.json",
    });
    const icons = await createAssetIconResolver({
      apiKey: "fixture-key",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (String(init?.body ?? "").includes("eth_call")) {
          const body = JSON.parse(String(init?.body)) as { id: number }[];
          return Response.json(
            body.map((request) =>
              request.id === 1 ? { id: 1, result: uri } : { id: request.id, result: "0x" },
            ),
          );
        }
        if (url.includes("metadata.example.test")) {
          return Response.json({ image: "https://onchain.example.test/nvda.png" });
        }
        return Response.json({
          data: {
            tokens: [
              {
                address: nvidia.contractAddress,
                networkId: "8453",
                info: { imageSmallUrl: "https://codex.example.test/nvda.png" },
              },
              {
                address: bitcoin.contractAddress,
                networkId: "8453",
                info: { imageSmallUrl: "https://codex.example.test/btc.png" },
              },
            ],
          },
        });
      },
    })();

    expect(icons.nvdac).toBe("https://onchain.example.test/nvda.png");
    expect(icons.cbbtc).toBe("https://codex.example.test/btc.png");
    expect(icons.cbxrp).toBeNull();
  });

  test("returns a null map for every configured stock/crypto when nothing resolves", () => {
    const empty = emptyAssetIconMap();
    expect(empty.nvdac).toBeNull();
    expect(empty.cbbtc).toBeNull();
    expect(Object.keys(empty).sort()).toEqual(
      [...stockAssets, ...cryptoAssets].map((asset) => asset.id).sort(),
    );
  });
});
