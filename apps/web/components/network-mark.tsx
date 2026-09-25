export function NetworkMark({ network }: { network: "base" }) {
  // oxlint-disable-next-line nextjs/no-img-element -- This bundled network mark needs no image optimization.
  return <img src={`/network-marks/${network}.svg`} alt="" aria-hidden="true" width={16} height={16} className="size-4 shrink-0" />;
}
