import type { ReactNode } from "react";
import type { InvestAssetId } from "@/config/invest-assets";
import styles from "./asset-icon.module.css";

type AssetIconProps = {
  assetId: string;
  label: string;
  size?: "sm" | "md";
};

const marks: Record<InvestAssetId, () => ReactNode> = {
  nvdac: NvidiaMark,
  metac: MetaMark,
  aaplc: AppleMark,
  googlc: AlphabetMark,
  cbbtc: BitcoinMark,
  cbxrp: XrpMark,
  cbdoge: DogecoinMark,
  cbltc: LitecoinMark,
  cbada: CardanoMark,
  degen: DegenMark,
  toshi: ToshiMark,
};

export function AssetIcon({ assetId, label, size = "sm" }: AssetIconProps) {
  const Mark = marks[assetId as InvestAssetId] ?? NeutralMark;
  return (
    <span
      className={`${styles.icon} ${styles[size]}`}
      role="img"
      aria-label={`${label} icon`}
    >
      <Mark />
    </span>
  );
}

function NeutralMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#0052ff" />
    </svg>
  );
}

function NvidiaMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#76B900" />
      <path
        d="M8 21.2c4.8 2.7 10.4 2.8 16.2.6 1.4-.5 2.7-1.2 3.8-2-3.8 4.4-10.4 6.4-16.6 4.4C9.8 23.6 8.7 22.5 8 21.2Zm.9-2.2c.7 1.1 1.8 2 3.2 2.5 5.3 1.8 11-.1 14.4-3.8-1 .6-2.2 1.1-3.4 1.5-5 1.8-9.8 1.6-13.8-.4-.2-.1-.3-.2-.4.2Zm8.8-6.3c-1.9 0-3.5 1.1-3.5 2.6 0 1.8 2 2.2 3.8 2.5 1.3.2 2.2.4 2.2 1 0 .5-.7.9-1.8.9-1.2 0-2.3-.3-3.3-.9v1.7c.9.4 2 .6 3.3.6 2.1 0 3.7-1 3.7-2.7 0-1.9-2-2.3-3.8-2.6-1.2-.2-2.1-.4-2.1-.9 0-.5.6-.8 1.6-.8.9 0 1.9.3 2.8.7v-1.6c-.9-.3-1.8-.5-2.9-.5Z"
        fill="#fff"
      />
    </svg>
  );
}

function MetaMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#0866FF" />
      <path
        d="M8.2 21.6c.9-3.6 3.2-6.6 5.6-6.6 1.6 0 2.6 1.1 3.6 3.1l.6 1.2c.7 1.5 1.3 2.4 2.2 2.4.9 0 1.6-.9 2.4-2.4.9-1.8 2-3.8 4.1-3.8 2.2 0 4.1 2.6 5.1 6.1h-2.5c-.7-2.2-1.8-3.8-2.8-3.8-.8 0-1.5.9-2.3 2.5-.9 1.8-2 3.7-4.1 3.7-1.6 0-2.6-1.1-3.6-3.1l-.6-1.2c-.7-1.4-1.3-2.3-2.1-2.3-.9 0-1.8 1.1-2.6 3.2-.2.6-.4 1.2-.5 1.8H8.2Z"
        fill="#fff"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#1D1D1F" />
      <path
        d="M22.8 11.4c.7-.9 1.2-2.1 1.1-3.4-1.1.1-2.4.7-3.1 1.6-.7.8-1.3 2.1-1.1 3.3 1.2.1 2.4-.6 3.1-1.5ZM23.9 13.3c-1.9-.1-3.5 1.1-4.4 1.1-.9 0-2.3-1-3.8-1-1.9 0-3.7 1.1-4.7 2.9-2 3.5-.5 8.6 1.4 11.5.9 1.4 2 2.9 3.5 2.9 1.4 0 1.9-.9 3.6-.9s2.1.9 3.6.9c1.5 0 2.5-1.4 3.4-2.8.7-1 1.2-2 1.5-3.1-3.9-1.5-4.5-7.1-.6-8.8-.8-1.1-2.1-1.8-3.5-1.7Z"
        fill="#fff"
      />
    </svg>
  );
}

function AlphabetMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#fff" />
      <path
        d="M28 18.2c0-.7-.1-1.4-.2-2H18.4v3.8h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"
        fill="#4285F4"
      />
      <path
        d="M18.4 28c2.7 0 5-0.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H9.5v2.6C11.1 26.4 14.5 28 18.4 28Z"
        fill="#34A853"
      />
      <path
        d="M12.8 19.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9v-2.6H9.5C8.8 14.8 8.4 16.4 8.4 18s.4 3.2 1.1 4.5l3.3-2.6Z"
        fill="#FBBC05"
      />
      <path
        d="M18.4 12.2c1.5 0 2.8.5 3.8 1.5l2.8-2.8C23.4 9.3 21.1 8.4 18.4 8.4c-3.9 0-7.3 1.6-8.9 4.3l3.3 2.6c.8-2.3 3-4.1 5.6-4.1Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function BitcoinMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#F7931A" />
      <path
        d="M23.1 16.2c.4-2.4-1.5-3.7-4-4.5l.8-3.3-2-.5-.8 3.2c-.5-.1-1.1-.2-1.6-.4l.8-3.2-2-.5-.8 3.3c-.4-.1-.9-.2-1.3-.3l.1-.3-2.7-.7-.5 2s1.5.3 1.4.4c.8.2 1 .7.9 1.1l-1 3.8c.1 0 .2 0 .2.1h-.2l-1.3 5.3c-.1.2-.3.6-.1.9.2.2.7.2.7.2h.1l-1.1 3.6 2.7.7.8-3.3c.6.1 1.1.3 1.6.4l-.8 3.3 2 .5.8-3.3c2.1.4 3.7.2 4.4-1.7.5-1.5 0-2.4-1.1-3 .8-.2 1.4-.7 1.6-1.8Zm-2.8 4c-.4 1.6-3.1.7-4 .5l.7-2.9c.9.2 3.7.7 3.3 2.4Zm.4-4c-.4 1.4-2.6.7-3.4.5l.7-2.6c.8.2 3.1.6 2.7 2.1Z"
        fill="#fff"
      />
    </svg>
  );
}

function XrpMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#23292F" />
      <path
        d="m10.2 12.4 4.6 4.6c.7.7 1.9.7 2.6 0l4.6-4.6h3.2l-5.8 5.8c-1.6 1.6-4.2 1.6-5.8 0l-5.8-5.8h3.2Zm0 11.2 4.6-4.6c.7-.7 1.9-.7 2.6 0l4.6 4.6h3.2l-5.8-5.8c-1.6-1.6-4.2-1.6-5.8 0l-5.8 5.8h3.2Z"
        fill="#fff"
      />
    </svg>
  );
}

function DogecoinMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#C2A633" />
      <path
        d="M15.2 9.4h4.1c4.4 0 7.5 3 7.5 8.6 0 5.6-3.1 8.6-7.5 8.6h-4.1V9.4Zm2.6 14.8h1.4c2.9 0 4.8-2.1 4.8-6.2 0-4.1-1.9-6.2-4.8-6.2h-1.4v12.4Zm-3.4-7.6h5.6v2.2h-5.6v-2.2Z"
        fill="#fff"
      />
    </svg>
  );
}

function LitecoinMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#345D9D" />
      <path
        d="M20.6 9.6 13.8 26.4h9.6v-2.2h-6.6l1.4-3.4h4.2v-2.1h-3.3l4.5-9.1h-3ZM16 18.2l1.2-2.8-2.4-.9-1.2 2.8 2.4.9Z"
        fill="#fff"
      />
    </svg>
  );
}

function CardanoMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#0033AD" />
      <circle cx="18" cy="10.2" r="1.15" fill="#fff" />
      <circle cx="18" cy="25.8" r="1.15" fill="#fff" />
      <circle cx="12.4" cy="13.4" r="1.15" fill="#fff" />
      <circle cx="23.6" cy="13.4" r="1.15" fill="#fff" />
      <circle cx="12.4" cy="22.6" r="1.15" fill="#fff" />
      <circle cx="23.6" cy="22.6" r="1.15" fill="#fff" />
      <circle cx="18" cy="18" r="1.55" fill="#fff" />
      <circle cx="8.8" cy="18" r="0.85" fill="#fff" />
      <circle cx="27.2" cy="18" r="0.85" fill="#fff" />
    </svg>
  );
}

function DegenMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#A36EFD" />
      <path
        d="M11 13.2h6.6c3.4 0 5.6 2.1 5.6 5.1 0 3-2.2 5.1-5.6 5.1H13.6V26H11V13.2Zm2.6 7.8h4c1.9 0 3-1.1 3-2.7s-1.1-2.7-3-2.7h-4V21Z"
        fill="#fff"
      />
    </svg>
  );
}

function ToshiMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#F5A623" />
      <path
        d="M10.4 14.2c1.6-2.6 4.3-3.8 7.6-3.8s6 1.2 7.6 3.8c.6 1 .4 1.8-.5 2.2l-1.8.8c-.6.3-1 .1-1.2-.5l-.4-1.1c-.6-1.3-1.7-2-3.7-2s-3.1.7-3.7 2l-.4 1.1c-.2.6-.6.8-1.2.5l-1.8-.8c-.9-.4-1.1-1.2-.5-2.2Zm1.4 8.2c0 3.4 2.6 5.6 6.2 5.6s6.2-2.2 6.2-5.6c0-1.1-.8-1.6-1.8-1.2-1.1.4-2.6.7-4.4.7s-3.3-.3-4.4-.7c-1-.4-1.8.1-1.8 1.2Z"
        fill="#fff"
      />
    </svg>
  );
}
