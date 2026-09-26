import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fetchPrStatus, prUrl, type PrStatus, type ReviewBuild } from "./review-build";
import styles from "./board.module.css";

const stateLabels: Record<PrStatus["state"], string> = {
  draft: "Draft", open: "Open", merged: "Merged", closed: "Closed",
};
const checkLabels: Record<PrStatus["checks"], string | undefined> = {
  passing: "Checks passing", failing: "Checks failing", pending: "Checks pending", none: undefined,
};

function commitUrl(build: ReviewBuild): string | undefined {
  if (!build.repo || !/^[\da-f]{7,40}$/i.test(build.revision)) return undefined;
  return `https://github.com/${build.repo.owner}/${build.repo.name}/commit/${build.revision}`;
}

function link(href: string, title: string) {
  return <a href={href} target="_blank" rel="noreferrer" title={title} />;
}

export function BuildChip({ build }: { build: ReviewBuild }) {
  const [status, setStatus] = useState<PrStatus | null>(null);
  const url = prUrl(build);
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    fetchPrStatus(build, abort.signal).then(setStatus).catch(() => setStatus(null));
    return () => abort.abort();
  }, [build, url]);
  const commit = build.revision.slice(0, 7);
  if (!url || !build.pr) {
    const text = build.branch ? `${commit} · ${build.branch}` : commit;
    const href = commitUrl(build);
    const title = build.branch ? `${build.revision} · ${build.branch}` : build.revision;
    return <Badge variant="outline" className={styles.chip}
      render={href ? link(href, title) : undefined} title={href ? undefined : title}>
      <span className={styles.chipText}>{text}</span>
    </Badge>;
  }
  const parts = [`#${build.pr}`, status && stateLabels[status.state],
    status && checkLabels[status.checks], commit].filter(Boolean);
  return <span className={styles.chipGroup}>
    <Badge variant="outline" className={styles.chip}
      render={link(url, status ? `${status.title} · ${build.revision}` : build.revision)}>
      <span className={styles.statusDot} data-checks={status?.checks ?? "none"} aria-hidden="true" />
      <span className={styles.chipText}>{parts.join(" · ")}</span>
    </Badge>
    {status && !status.current && <Badge variant="warning" className={styles.chip}
      render={link(status.url, `PR head is ${status.headSha.slice(0, 7)}`)}>
      Newer commit on PR
    </Badge>}
  </span>;
}
