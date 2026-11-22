"use client";

import type { CSSProperties, ReactNode } from "react";
import { useDimensionalMotion } from "./use-dimensional-motion";
import styles from "./dimensional.module.css";

type Place = { x: number; y: number; z: number };

function place({ x, y, z }: Place, extra?: CSSProperties): CSSProperties {
  return { "--x": `${x}px`, "--y": `${y}px`, "--z": `${z}px`, ...extra } as CSSProperties;
}

function Coin({ face }: { face?: boolean }) {
  return (
    <span className={styles.coin} data-face={face ? "" : undefined}>
      {face ? <span className={styles.coinGlyph}>$</span> : null}
    </span>
  );
}

function CoinStack({ at, count }: { at: Place; count: number }) {
  return (
    <div className={styles.stack} style={place(at)}>
      <span className={styles.stackShadow} />
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={styles.stackLayer} style={{ "--i": index } as CSSProperties}>
          <Coin face={index === count - 1} />
        </span>
      ))}
    </div>
  );
}

function Floating({ at, w, h, delay, children }: { at: Place; w: number; h: number; delay: number; children: ReactNode }) {
  return (
    <div className={styles.floating} style={place(at, { "--w": `${w}px`, "--h": `${h}px`, "--delay": `${delay}s` } as CSSProperties)}>
      <span className={styles.cardShadow} />
      <div className={styles.bob}>
        <div className={styles.card}>{children}</div>
      </div>
    </div>
  );
}

function BalanceCard() {
  return (
    <div className="flex h-full flex-col justify-between p-6">
      <div>
        <p className="text-sm text-muted-foreground">Total balance</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">$6,185.08</p>
      </div>
      <div className="space-y-2.5">
        <div className="flex h-2 gap-0.5">
          <span className="rounded-full bg-(--balance-bar-cash)" style={{ flexGrow: 1804 }} />
          <span className="rounded-full bg-(--balance-bar-investments)" style={{ flexGrow: 4381 }} />
        </div>
        <div className="grid grid-cols-2 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-1.5 rounded-xs bg-(--balance-bar-cash)" />Cash</span>
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-1.5 rounded-xs bg-(--balance-bar-investments)" />Investments</span>
          <span className="mt-1 tabular-nums">$1,804.00</span>
          <span className="mt-1 tabular-nums">$4,381.08</span>
        </div>
      </div>
    </div>
  );
}

const layerTones = ["#00237f", "#002d9e", "#0036bb", "#003fd6"] as const;

const activity = [
  ["Added money", "Apple Pay", "+$200.00"],
  ["Sent", "0x2211…d77DA9", "−$25.00"],
  ["Cashed out", "Cash App", "−$50.00"],
] as const;

function ActivityCard() {
  return (
    <div className="flex h-full flex-col px-5 py-4">
      <p className="text-base font-semibold">Activity</p>
      <div className="mt-2 flex flex-1 flex-col justify-around">
        {activity.map(([title, detail, amount]) => (
          <div key={title} className="flex items-center gap-3">
            <span className="size-8 shrink-0 rounded-full bg-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{title}</span>
              <span className="block truncate text-xs text-muted-foreground">{detail}</span>
            </span>
            <span className="text-sm tabular-nums">{amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavingsCard() {
  return (
    <div className="flex h-full flex-col justify-center gap-1 px-5">
      <p className="text-sm text-muted-foreground">Savings</p>
      <p className="text-2xl font-semibold tabular-nums">$100.00</p>
      <p className="text-xs text-muted-foreground">USDC · Morpho vault</p>
    </div>
  );
}

function LooseCoin({ at, size, duration }: { at: Place; size: number; duration: number }) {
  return (
    <div className={styles.hover} style={place(at, { "--size": `${size}px`, "--spin": `${duration}s` } as CSSProperties)}>
      <div className={styles.billboard}>
        <div className={styles.spin}>
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index} className={styles.spinLayer} style={{ "--i": index } as CSSProperties}>
              <Coin face={index === 0 || index === 6} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DimensionalScene() {
  const { root, rig } = useDimensionalMotion();
  return (
    <div ref={root} className={styles.scene} aria-hidden="true">
      <div className={styles.wash} />
      <div className={styles.stage}>
        <div ref={rig} className={styles.rig}>
          <span className={styles.groundShadow} />
          <LooseCoin at={{ x: 330, y: 760, z: 110 }} size={92} duration={12} />
          <LooseCoin at={{ x: 640, y: -150, z: 340 }} size={68} duration={15} />
          <div className={styles.slab}>
            {layerTones.map((tone, index) => (
              <span key={tone} className={styles.layer} style={{ "--d": `${index * 7}px`, background: tone } as CSSProperties} />
            ))}
            <div className={styles.surface}>
              <span className={styles.sheen} />
            </div>
            <div className={styles.plate} style={place({ x: 64, y: 60, z: 0 })} />
            <Floating at={{ x: 92, y: 88, z: 96 }} w={360} h={200} delay={0}>
              <BalanceCard />
            </Floating>
            <Floating at={{ x: 430, y: 372, z: 54 }} w={320} h={220} delay={-2.4}>
              <ActivityCard />
            </Floating>
            <Floating at={{ x: 112, y: 404, z: 138 }} w={230} h={124} delay={-4.1}>
              <SavingsCard />
            </Floating>
            <CoinStack at={{ x: 560, y: 96, z: 0 }} count={9} />
            <CoinStack at={{ x: 650, y: 168, z: 0 }} count={5} />
            <CoinStack at={{ x: 360, y: 560, z: 0 }} count={7} />
            <LooseCoin at={{ x: 330, y: 280, z: 210 }} size={120} duration={9} />
          </div>
        </div>
      </div>
    </div>
  );
}
