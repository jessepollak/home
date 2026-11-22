import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import type { ReactNode } from "react";
import { captureCaption, captures, customerFacts, docs, lede, licence, talkLead, operatorFacts, pitch, repo, requirementFacts, status, talkToUs, type Fact } from "../../content";
import styles from "./page.module.css";

const grotesk = localFont({
  src: "./fonts/InterTight-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-b",
});

export const metadata: Metadata = {
  title: "Home · Direction b",
  robots: { index: false },
};

const [pitchLead, ...pitchRest] = pitch.split(/(?<=\.)\s+/);
const phoneClass = [styles.phoneLeft, styles.phoneCenter, styles.phoneRight];

function Facts({ facts, layout }: { facts: Fact[]; layout: "grid" | "rows" | "cards" }) {
  const layoutClass = layout === "grid" ? styles.factsGrid : layout === "rows" ? styles.factsRows : styles.factsCards;
  return (
    <dl className={`${styles.facts} ${layoutClass}`}>
      {facts.map((fact) => (
        <div key={fact.term} className={styles.fact}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Band({ id, title, tone, children }: { id: string; title: string; tone: "paper" | "blue" | "tint"; children: ReactNode }) {
  return (
    <section className={`${styles.band} ${styles[tone]}`} aria-labelledby={id}>
      <div className={styles.inner}>
        <h2 id={id} className={styles.bandTitle}>
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

export default function DirectionB() {
  return (
    <div className={`${grotesk.variable} ${styles.root}`}>
      <div className={styles.hero}>
        <header className={`${styles.inner} ${styles.masthead}`}>
          <span className={styles.wordmark}>Home</span>
          <nav aria-label="Primary" className={styles.nav}>
            <a href={repo}>GitHub</a>
            <a href={talkToUs}>Talk to us</a>
          </nav>
        </header>

        <div className={`${styles.inner} ${styles.intro}`}>
          <h1 className={styles.pitch}>
            <span>{pitchLead}</span> <span className={styles.pitchAccent}>{pitchRest.join(" ")}</span>
          </h1>
          <div className={styles.introFoot}>
            <p className={styles.lede}>{lede}</p>
            <div className={styles.actions}>
              <a className={styles.buttonSolid} href={talkToUs}>
                Talk to us on X
              </a>
              <a className={styles.buttonGhost} href={repo}>
                Read the code on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>

      <main>
        <figure className={styles.stage}>
          <div className={styles.phones}>
            {captures.map((capture, index) => (
              <div key={capture.src} className={`${styles.phone} ${phoneClass[index]}`}>
                <Image src={capture.src} alt={capture.alt} width={780} height={1688} loading="eager" sizes="(min-width: 64rem) 24rem, 55vw" />
              </div>
            ))}
          </div>
          <figcaption className={`${styles.inner} ${styles.caption}`}>{captureCaption}</figcaption>
        </figure>

        <Band id="customers" title="What your customers get" tone="paper">
          <Facts facts={customerFacts} layout="grid" />
        </Band>

        <Band id="operators" title="What you get" tone="blue">
          <Facts facts={operatorFacts} layout="rows" />
        </Band>

        <Band id="requirements" title="What it takes to run" tone="tint">
          <p className={styles.bandLead}>
            Each operator runs their own instance on their own accounts. Start with the <a href={`${docs}/vercel-deploy.md`}>deploy guide</a> and the{" "}
            <a href={`${docs}/operator-checklist.md`}>operator checklist</a>.
          </p>
          <Facts facts={requirementFacts} layout="cards" />
        </Band>

        <Band id="status" title="Where it stands today" tone="paper">
          <ul className={styles.status}>
            {status.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Band>

        <section className={`${styles.band} ${styles.blue} ${styles.talk}`} aria-labelledby="talk">
          <div className={styles.inner}>
            <h2 id="talk" className={styles.talkTitle}>
              Talk to us
            </h2>
            <p className={styles.talkBody}>
              {talkLead} <a href={talkToUs}>Message @jessepollak on X</a>, or open an issue on <a href={repo}>GitHub</a>.
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p className={styles.inner}>
          Home's original code is open source under the <a href={licence}>MIT licence</a>. Marks and fonts keep their own terms.
        </p>
      </footer>
    </div>
  );
}
