import { Suspense } from "react";
import { MoneyModalQaClient } from "./money-modal-qa-client";

export const metadata = {
  title: "MoneyModal amount QA",
  robots: { index: false, follow: false },
};

export default function MoneyModalQaPage() {
  return (
    <Suspense>
      <MoneyModalQaClient />
    </Suspense>
  );
}
