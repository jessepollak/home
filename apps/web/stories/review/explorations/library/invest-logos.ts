import { http, HttpResponse } from "msw";
import { assetKeyForInvestAsset, type AssetMarkResolution } from "@/client/asset-mark/presentation";
import { investAssets } from "@/config/invest-assets";

const images: Record<string, string> = {
  nvdac: "https://token-media.defined.fi/8453_0xb20000000000000000000078ee7ce2fe4908108c_small_fc537850c87a.png",
  metac: "https://token-media.defined.fi/8453_0xb2000000000000000000008bc8786b856e61707c_small_b59b92095cd7.png",
  aaplc: "https://token-media.defined.fi/8453_0xb200000000000000000000c2e324d24d7eecd1fb_small_309f55d6cc9c.png",
  googlc: "https://token-media.defined.fi/8453_0xb2000000000000000000002d0ba3164cc74f58b7_small_69b6124b23a7.png",
  amznc: "https://token-media.defined.fi/8453_0xb200000000000000000000d9192b6b456483c2e8_small_2ec0a5c3f900.png",
  msftc: "https://token-media.defined.fi/8453_0xb200000000000000000000ab99cfa739e253872b_small_22b338d93966.png",
  mstrc: "https://token-media.defined.fi/8453_0xb2000000000000000000004884b426556b92883d_small_0572aa267a15.png",
  sndkc: "https://token-media.defined.fi/8453_0xb200000000000000000000397293cb8cda9a10c5_small_5e085c759f33.png",
  spcxc: "https://token-media.defined.fi/8453_0xb2000000000000000000007b9fcbd005511acbd5_small_7d000ac1006a.png",
  tslac: "https://token-media.defined.fi/8453_0xb2000000000000000000001e800a7f5189430cd0_small_d74c0eba42e6.png",
  cbbtc: "https://media.thegrid.id/1125/7/id1738636878-09Pp1Wq-RuiM6uRHuyiTog/id1761223287-yofTwDGNQzWuWUaALp4d4Q/image-1773923530.png",
};

export const investLogoResolution: AssetMarkResolution = {
  images: Object.fromEntries(investAssets.flatMap((asset) => {
    const image = images[asset.id];
    return image ? [[assetKeyForInvestAsset(asset), image]] : [];
  })),
  pending: false,
};

export const investLogoHandlers = Object.entries(images).map(([id, image]) => http.get(image, async () => {
  const response = await fetch(`/asset-marks/invest/${id}.png`);
  if (!response.ok) throw new Error(`Missing ${id} logo fixture`);
  return new HttpResponse(await response.arrayBuffer(), { headers: { "content-type": "image/png" } });
}));
