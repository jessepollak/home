"use client";

import type { BackdropProps } from "./backdrop";
import styles from "./depth/depth.module.css";
import { useDepth } from "./depth/use-depth";

function Bar({ className }: { className: string }) {
  return <span className={`${styles.bar} ${className}`} />;
}

function BalanceGhost() {
  return (
    <>
      <Bar className="w-20" />
      <span className={`${styles.bar} ${styles.amount}`} />
      <span className={styles.split}>
        <span className={styles.cash} />
        <span className={styles.investments} />
      </span>
      <span className="mt-3 flex gap-6">
        <Bar className="w-14" />
        <Bar className="w-16" />
      </span>
    </>
  );
}

function ActivityGhost() {
  return (
    <>
      <Bar className="w-16" />
      {[0, 1, 2].map((row) => (
        <span key={row} className="mt-4 flex items-center gap-3">
          <span className={styles.dot} />
          <span className="flex flex-1 flex-col gap-1.5">
            <Bar className="w-24" />
            <Bar className="w-16 opacity-60" />
          </span>
          <Bar className="w-12" />
        </span>
      ))}
    </>
  );
}

function ReviewGhost() {
  return (
    <>
      <span className={`${styles.dot} mx-auto`} />
      <Bar className="mx-auto mt-3 w-24" />
      {[0, 1, 2, 3].map((row) => (
        <span key={row} className="mt-4 flex justify-between">
          <Bar className="w-12 opacity-60" />
          <Bar className="w-20" />
        </span>
      ))}
    </>
  );
}

const heroLayers = [
  { depth: "back", Ghost: ReviewGhost },
  { depth: "mid", Ghost: ActivityGhost },
  { depth: "front", Ghost: BalanceGhost },
] as const;

function HeroLayer() {
  return (
    <div aria-hidden="true" className={styles.layer}>
      <div className={styles.heroFrame}>
        <div className={styles.heroStack}>
          {heroLayers.map(({ depth, Ghost }) => (
            <div key={depth} className={styles.heroDrift} data-depth={depth}>
              <div className={styles.heroSettle}>
                <div className={styles.heroCard}>
                  <Ghost />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoLayer() {
  return (
    <div aria-hidden="true" className={styles.demoStack}>
      {(["near", "far"] as const).map((depth) => (
        <div key={depth} className={styles.demoDrift} data-depth={depth}>
          <div className={styles.demoGhost} />
        </div>
      ))}
    </div>
  );
}

function CustomersLayer() {
  return (
    <div aria-hidden="true" className={styles.layer}>
      <div className={styles.boundary} />
    </div>
  );
}

function TeamLayer() {
  return (
    <div aria-hidden="true" className={styles.layer}>
      <div className={styles.lift} />
    </div>
  );
}

const layers = { hero: HeroLayer, customers: CustomersLayer, team: TeamLayer, demo: DemoLayer };

export function DepthBackdrop({ region, children }: BackdropProps) {
  const ref = useDepth<HTMLDivElement>();
  const Layer = layers[region];
  return (
    <div ref={ref} className={styles.root} data-depth-region={region}>
      <Layer />
      {children}
    </div>
  );
}
