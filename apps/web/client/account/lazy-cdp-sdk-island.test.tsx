import "./dom-test-harness";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  Suspense,
  useCallback,
  useState,
  type ComponentType,
} from "react";
import {
  createLazyCdpSdkIsland,
  LazyCdpErrorBoundary,
  LazyCdpFailure,
} from "./lazy-cdp-sdk-island";
import type { CdpSdkBoundary } from "./cdp-sdk-provider";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

describe("lazy CDP SDK island", () => {
  test("reports a rejected module attempt and retries with a fresh lazy loader", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    let loadAttempts = 0;
    let reportedErrors = 0;
    const SuccessfulIsland = (() => <div>CDP ready</div>) as ComponentType<{
      projectId: string;
      onBoundary: (boundary: CdpSdkBoundary) => void;
      onError: () => void;
    }>;
    const load = async () => {
      loadAttempts += 1;
      if (loadAttempts === 1) throw new Error("CDP module failed to load.");
      return { CdpSdkIsland: SuccessfulIsland };
    };

    function Attempt({ onError }: { onError: () => void }) {
      const [LazyIsland] = useState(() => createLazyCdpSdkIsland(load));
      return (
        <LazyCdpErrorBoundary fallback={<LazyCdpFailure onError={onError} />}>
          <Suspense fallback={<div>Loading CDP</div>}>
            <LazyIsland projectId="project-id" onBoundary={() => {}} onError={onError} />
          </Suspense>
        </LazyCdpErrorBoundary>
      );
    }

    function Harness() {
      const [attempt, setAttempt] = useState(0);
      const [failed, setFailed] = useState(false);
      const onError = useCallback(() => {
        reportedErrors += 1;
        setFailed(true);
      }, []);
      if (failed) {
        return (
          <button
            type="button"
            onClick={() => {
              setAttempt((current) => current + 1);
              setFailed(false);
            }}
          >
            Retry CDP
          </button>
        );
      }
      return <Attempt key={attempt} onError={onError} />;
    }

    const view = render(<Harness />);
    await view.findByRole("button", { name: "Retry CDP" });
    expect(loadAttempts).toBe(1);
    expect(reportedErrors).toBe(1);

    fireEvent.click(view.getByRole("button", { name: "Retry CDP" }));
    await view.findByText("CDP ready");
    await waitFor(() => expect(loadAttempts).toBe(2));
    expect(reportedErrors).toBe(1);
    consoleError.mockRestore();
  });
});
