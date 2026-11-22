import Image from "next/image";
import type { ReactNode } from "react";
import { captureCaption, captures, customerFacts, docs, lede, licence, talkLead, operatorFacts, pitch, repo, requirementFacts, status, talkToUs, type Fact } from "./content";

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="facts">
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div>{children}</div>
    </section>
  );
}


export default function Page() {
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Home</span>
        <nav aria-label="Primary">
          <a href={repo}>GitHub</a>
          <a href={talkToUs}>Talk to us</a>
        </nav>
      </header>

      <main>
        <div className="intro">
          <h1>{pitch}</h1>
          <p className="lede">{lede}</p>
          <div className="intro-links">
            <a href={talkToUs}>Talk to us on X</a>
            <a href={repo}>Read the code on GitHub</a>
          </div>
        </div>

        <figure className="captures">
          <div className="captures-row">
            {captures.map((capture) => (
              <Image key={capture.src} src={capture.src} alt={capture.alt} width={780} height={1688} loading="eager" />
            ))}
          </div>
          <figcaption>{captureCaption}</figcaption>
        </figure>

        <Section id="customers" title="What your customers get">
          <Facts facts={customerFacts} />
        </Section>

        <Section id="operators" title="What you get">
          <Facts facts={operatorFacts} />
        </Section>

        <Section id="requirements" title="What it takes to run">
          <p>
            Each operator runs their own instance on their own accounts. Start with the <a href={`${docs}/vercel-deploy.md`}>deploy guide</a> and the{" "}
            <a href={`${docs}/operator-checklist.md`}>operator checklist</a>.
          </p>
          <Facts facts={requirementFacts} />
        </Section>

        <Section id="status" title="Where it stands today">
          <ul className="status">
            {status.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>

        <Section id="talk" title="Talk to us">
          <p>
            {talkLead} <a href={talkToUs}>Message @jessepollak on X</a>, or open an issue on{" "}
            <a href={repo}>GitHub</a>.
          </p>
        </Section>
      </main>

      <footer className="footer">
        <p>
          Home's original code is open source under the <a href={licence}>MIT licence</a>. Marks and fonts keep their own terms.
        </p>
      </footer>
    </div>
  );
}
