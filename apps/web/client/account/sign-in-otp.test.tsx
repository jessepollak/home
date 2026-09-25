import "./dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { createRef, useState } = await import("react");
const { SignInOtp } = await import("./sign-in-otp");

function Harness({ invalid = false, verifying = false, onChange }: {
  invalid?: boolean;
  verifying?: boolean;
  onChange?: (value: string) => void;
}) {
  const [otp, setOtp] = useState("");
  const [ref] = useState(() => createRef<HTMLInputElement>());
  return (
    <SignInOtp
      email="fixture@example.test"
      otp={otp}
      invalid={invalid}
      isSendingCode={false}
      isVerifyingCode={verifying}
      resendSeconds={30}
      inputRef={ref}
      onOtpChange={(next) => { onChange?.(next); setOtp(next); }}
      onSubmit={(event) => event.preventDefault()}
      onChangeEmail={() => {}}
      onResend={() => {}}
    />
  );
}

afterEach(cleanup);

describe("sign-in verification code", () => {
  test("has a single named numeric OTP input and enables verification only at six digits", () => {
    const changes: string[] = [];
    const view = (otp: string) => (
      <SignInOtp
        email="fixture@example.test"
        otp={otp}
        invalid={false}
        isSendingCode={false}
        isVerifyingCode={false}
        resendSeconds={30}
        inputRef={createRef()}
        onOtpChange={(next) => changes.push(next)}
        onSubmit={(event) => event.preventDefault()}
        onChangeEmail={() => {}}
        onResend={() => {}}
      />
    );
    const { rerender } = render(view(""));
    const input = page().getByRole("textbox", { name: "Verification code" }) as HTMLInputElement;
    const verify = page().getByRole("button", { name: "Verify and continue" }) as HTMLButtonElement;
    expect(input.autocomplete).toBe("one-time-code");
    expect(input.inputMode).toBe("numeric");
    expect(input.maxLength).toBe(6);
    expect(verify.disabled).toBe(true);
    rerender(view("12345"));
    expect(verify.disabled).toBe(true);
    rerender(view("123456"));
    expect(verify.disabled).toBe(false);
    expect(page().getAllByRole("textbox", { name: "Verification code" })).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="input-otp-slot"][aria-hidden="true"]')).toHaveLength(6);
  });

  test("formatted paste preserves a leading zero", () => {
    const changes: string[] = [];
    render(<Harness onChange={(value) => changes.push(value)} />);
    const input = page().getByRole("textbox", { name: "Verification code" }) as HTMLInputElement;
    input.focus();
    fireEvent.paste(input, { clipboardData: { getData: () => "012-345" } });
    expect(input.value).toBe("012345");
    expect(changes.at(-1)).toBe("012345");
  });

  test("invalid marks the input and verifying disables it and submit", () => {
    render(<Harness invalid verifying />);
    const input = page().getByRole("textbox", { name: "Verification code" }) as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.disabled).toBe(true);
    expect((page().getByRole("button", { name: "Verifying…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
