import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import type { ReactNode } from "react";
import { captureCaption, captures, customerFacts, docs, lede, licence, operatorFacts, pitch, repo, requirementFacts, status, talkLead, talkToUs } from "../../content";
import s from "./page.module.css";

const mono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  weight: "100 800",
  variable: "--c-font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

const sans = localFont({
  src: "./fonts/InterTight-latin.woff2",
  weight: "100 900",
  variable: "--c-font-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Home · Direction c",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0a101b",
};

const pad = (n: number) => String(n).padStart(2, "0");

function Section({ index, id, title, children }: { index: number; id: string; title: string; children: ReactNode }) {
  return (
    <section className={s.section} aria-labelledby={id}>
      <div className={s.sectionHead}>
        <span className={s.sectionIndex} aria-hidden="true">
          §{pad(index)}
        </span>
        <h2 id={id}>{title}</h2>
      </div>
      <div className={s.sectionBody}>{children}</div>
    </section>
  );
}

export default function Page() {
  const repoPath = repo.replace("https://", "");

  return (
    <div className={`${s.root} ${mono.variable} ${sans.variable}`}>
      <div className={s.frame}>
        <header className={s.masthead}>
          <span className={s.wordmark}>
            <svg className={s.reticle} viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="4.5" />
              <path d="M8 0v5M8 11v5M0 8h5M11 8h5" />
            </svg>
            Home
          </span>
          <nav aria-label="Primary" className={s.nav}>
            <a href={repo}>GitHub</a>
            <a href={talkToUs}>Talk to us</a>
          </nav>
        </header>

        <main>
          <div className={s.intro}>
            <p className={s.path} aria-hidden="true">
              <span className={s.prompt}>~/</span>
              {repoPath}
            </p>
            <h1 className={s.pitch}>
              {pitch}
              <span className={s.caret} aria-hidden="true" />
            </h1>
            <div className={s.introAside}>
              <p className={s.lede}>{lede}</p>
              <div className={s.actions}>
                <a className={s.primary} href={talkToUs}>
                  Talk to us on X
                </a>
                <a className={s.secondary} href={repo}>
                  Read the code on GitHub
                </a>
              </div>
            </div>
          </div>

          <figure className={s.plate}>
            <div className={s.plateRail}>
              {captures.map((capture, i) => (
                <div key={capture.src} className={s.specimen}>
                  <div className={s.specMeta} aria-hidden="true">
                    <span>Fig. {i + 1}</span>
                    <span>{capture.src.split("/").pop()}</span>
                  </div>
                  <div className={s.dimX} aria-hidden="true">
                    <span>780</span>
                  </div>
                  <div className={s.specBody}>
                    <div className={s.specFrame}>
                      <Image src={capture.src} alt={capture.alt} width={780} height={1688} loading="eager" sizes="(min-width: 64rem) 18rem, 62vw" />
                    </div>
                    <div className={s.dimY} aria-hidden="true">
                      <span>1688</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <figcaption className={s.plateCaption}>{captureCaption}</figcaption>
          </figure>

          <Section index={1} id="customers" title="What your customers get">
            <dl className={s.cells}>
              {customerFacts.map((fact, i) => (
                <div key={fact.term} className={s.cell}>
                  <span className={s.cellIndex} aria-hidden="true">
                    {pad(i + 1)}
                  </span>
                  <dt>{fact.term}</dt>
                  <dd>{fact.detail}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section index={2} id="operators" title="What you get">
            <dl className={s.table}>
              {operatorFacts.map((fact, i) => (
                <div key={fact.term} className={s.row}>
                  <span className={s.rowIndex} aria-hidden="true">
                    {pad(i + 1)}
                  </span>
                  <dt>{fact.term}</dt>
                  <dd>{fact.detail}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section index={3} id="requirements" title="What it takes to run">
            <p className={s.note}>
              Each operator runs their own instance on their own accounts. Start with the <a href={`${docs}/vercel-deploy.md`}>deploy guide</a> and the{" "}
              <a href={`${docs}/operator-checklist.md`}>operator checklist</a>.
            </p>
            <div className={s.stack}>
              <div className={s.core} aria-hidden="true">
                <span className={s.corePorts} />
                <span className={s.coreName}>Home</span>
              </div>
              <dl className={s.deps}>
                {requirementFacts.map((fact, i) => (
                  <div key={fact.term} className={s.dep}>
                    <span className={s.depIndex} aria-hidden="true">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <dt>{fact.term}</dt>
                    <dd>{fact.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Section>

          <Section index={4} id="status" title="Where it stands today">
            <ul className={s.listing}>
              {status.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>

          <Section index={5} id="talk" title="Talk to us">
            <p className={s.talk}>
              {talkLead} <a href={talkToUs}>Message @jessepollak on X</a>, or open an issue on <a href={repo}>GitHub</a>.
              <span className={s.caret} aria-hidden="true" />
            </p>
          </Section>
        </main>

        <footer className={s.footer}>
          <p>
            Home&apos;s original code is open source under the <a href={licence}>MIT licence</a>. Marks and fonts keep their own terms.
          </p>
        </footer>
      </div>
    </div>
  );
}
