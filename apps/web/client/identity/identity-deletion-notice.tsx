"use client";

import { identityOwner, useIdentityVerificationStatus, type IdentityWallet } from "./use-identity-verification-status";

export function IdentityDeletionNotice({ wallet }: { wallet: IdentityWallet | null }) {
  const owner = identityOwner(wallet);
  return owner && wallet
    ? <IdentityDeletionNoticeForOwner key={owner} wallet={wallet} owner={owner} />
    : <DeletionNotice supportUrl={null} />;
}

function IdentityDeletionNoticeForOwner({ wallet, owner }: { wallet: IdentityWallet; owner: string }) {
  const query = useIdentityVerificationStatus(wallet, owner);
  return <DeletionNotice supportUrl={query.data?.supportUrl ?? null} />;
}

function DeletionNotice({ supportUrl }: { supportUrl: string | null }) {
  return (
    <p className="text-sm text-muted-foreground">
      Identity verification is provided by Sumsub, which collects and holds your ID documents and biometric data. Home keeps a verification record that every sign-in linked to your Home profile shares: the Home and Sumsub applicant identifiers, the verification level, the review status and outcome, any retry reason, the consent version and language, and dates for consent, approval, and status updates. Home holds no ID documents, images, or personal details. To request deletion, {supportUrl ? (
        <a className="font-medium text-primary" href={supportUrl} target="_blank" rel="noopener noreferrer">contact Home support</a>
      ) : "contact Home support"}; Home forwards your request to Sumsub, which handles it under its{" "}
      <a className="font-medium text-primary" href="https://sumsub.com/privacy-notice/" target="_blank" rel="noopener noreferrer">privacy notice</a>. If verification was finally declined, Home keeps a record of that decision after a deletion request.
    </p>
  );
}
