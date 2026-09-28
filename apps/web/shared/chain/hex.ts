import { isAddress, isHash } from "viem";

declare const addressBrand: unique symbol;
declare const hash32Brand: unique symbol;

export type Address = `0x${Lowercase<string>}` & { readonly [addressBrand]: true };
export type Hash32 = `0x${Lowercase<string>}` & { readonly [hash32Brand]: true };

export function parseAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value, { strict: true })
    ? value.toLowerCase() as Address
    : null;
}

export function parseHash32(value: unknown): Hash32 | null {
  return typeof value === "string" && isHash(value)
    ? value.toLowerCase() as Hash32
    : null;
}
