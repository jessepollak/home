import { Suspense } from "react";
import { AddMoneyQaClient } from "./add-money-qa-client";

export default function AddMoneyQaPage() {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <Suspense fallback={null}>
      <AddMoneyQaClient />
    </Suspense>
  );
}
