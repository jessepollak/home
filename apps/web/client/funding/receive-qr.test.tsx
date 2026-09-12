import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, render } = await import("@testing-library/react");
const { RECEIVE_QR_DISPLAY_PX, ReceiveQr } = await import("./receive-qr");

const ADDRESS = "0x1111111111111111111111111111111111111111";
afterEach(cleanup);

describe("ReceiveQr", () => {
  test("encodes the Base smart-account address into a large light-field SVG QR", () => {
    const view = render(
      <ReceiveQr value={ADDRESS} label={`QR code for Base address ${ADDRESS}`} />,
    );
    const svg = view.getByRole("img", { name: `QR code for Base address ${ADDRESS}` });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("width")).toBe(String(RECEIVE_QR_DISPLAY_PX));
    expect(svg.getAttribute("height")).toBe(String(RECEIVE_QR_DISPLAY_PX));
    expect(RECEIVE_QR_DISPLAY_PX).toBeGreaterThanOrEqual(200);
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#fff");
    expect(svg.querySelector("path")?.getAttribute("d")).toBeTruthy();
  });

});
