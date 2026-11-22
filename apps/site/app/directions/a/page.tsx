import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import type { ReactNode } from "react";
import { captureCaption, captures, customerFacts, docs, lede, licence, talkLead, operatorFacts, pitch, repo, requirementFacts, status, talkToUs, type Fact } from "../../content";
import styles from "./page.module.css";

const serif = localFont({
  src: [
    { path: "./fonts/fraunces-latin-opsz-wght.woff2", style: "normal" },
    { path: "./fonts/fraunces-latin-opsz-wght-italic.woff2", style: "italic" },
  ],
  weight: "100 900",
  display: "swap",
  variable: "--a-serif",
});

const sans = localFont({
  src: "./fonts/instrument-sans-latin-wght.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--a-sans",
});

export const metadata: Metadata = {
  title: "Home · Direction A",
  robots: { index: false },
};

const numerals = ["I", "II", "III"];

const pitchBreak = pitch.indexOf(". ") + 1;
const pitchLead = pitch.slice(0, pitchBreak);
const pitchTail = pitch.slice(pitchBreak + 1);

function Section({ id, number, title, children, wide }: { id: string; number: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? `${styles.section} ${styles.sectionWide}` : styles.section} aria-labelledby={id}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionNumber} aria-hidden="true">
          {number}
        </span>
        <h2 id={id}>{title}</h2>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function RunIn({ facts }: { facts: Fact[] }) {
  return (
    <dl className={styles.runIn}>
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Ledger({ facts }: { facts: Fact[] }) {
  return (
    <dl className={styles.ledger}>
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Columns({ facts }: { facts: Fact[] }) {
  return (
    <dl className={styles.columns}>
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function DirectionA() {
  return (
    <div className={`${styles.root} ${serif.variable} ${sans.variable}`}>
      <div className={styles.sheet}>
        <header className={styles.masthead}>
          <nav aria-label="Primary" className={styles.nav}>
            <a href={repo}>GitHub</a>
            <a href={talkToUs}>Talk to us</a>
          </nav>
          <span className={styles.nameplate}>Home</span>
        </header>

        <main>
          <div className={styles.front}>
            <h1 className={styles.headline}>
              <span>{pitchLead}</span> <em>{pitchTail}</em>
            </h1>
            <div className={styles.standfirst}>
              <p className={styles.lede}>{lede}</p>
              <ul className={styles.frontLinks}>
                <li>
                  <a href={talkToUs}>Talk to us on X</a>
                </li>
                <li>
                  <a href={repo}>Read the code on GitHub</a>
                </li>
              </ul>
            </div>
          </div>

          <figure className={styles.plates}>
            <ol className={styles.plateRow}>
              {captures.map((capture, index) => (
                <li key={capture.src} className={styles.plate}>
                  <div className={styles.plateMount}>
                    <Image src={capture.src} alt={capture.alt} width={780} height={1688} loading="eager" sizes="(min-width: 64rem) 22rem, 72vw" />
                  </div>
                  <p className={styles.plateLabel} aria-hidden="true">
                    <span>{numerals[index]}</span>
                    {capture.alt}
                  </p>
                </li>
              ))}
            </ol>
            <figcaption className={styles.plateCaption}>{captureCaption}</figcaption>
          </figure>

          <Section id="customers" number="01" title="What your customers get" wide>
            <RunIn facts={customerFacts} />
          </Section>

          <Section id="operators" number="02" title="What you get">
            <Ledger facts={operatorFacts} />
          </Section>

          <Section id="requirements" number="03" title="What it takes to run" wide>
            <p className={styles.intro}>
              Each operator runs their own instance on their own accounts. Start with the <a href={`${docs}/vercel-deploy.md`}>deploy guide</a> and the{" "}
              <a href={`${docs}/operator-checklist.md`}>operator checklist</a>.
            </p>
            <Columns facts={requirementFacts} />
          </Section>

          <Section id="status" number="04" title="Where it stands today">
            <ul className={styles.status}>
              {status.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>

          <Section id="talk" number="05" title="Talk to us">
            <p className={styles.talk}>
              <span className={styles.talkLead}>{talkLead}</span> <a href={talkToUs}>Message @jessepollak on X</a>, or open an issue on{" "}
              <a href={repo}>GitHub</a>.
            </p>
          </Section>
        </main>

        <footer className={styles.footer}>
          <span className={styles.footerMark} aria-hidden="true">
            Home
          </span>
          <p>
            Home's original code is open source under the <a href={licence}>MIT licence</a>. Marks and fonts keep their own terms.
          </p>
        </footer>
      </div>
    </div>
  );
}
