import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AddressText } from "../../components/address-text";
import { CopyableValue } from "../../components/copyable-value";
import { MoneyConfirmSummary } from "../../client/money-modal/confirm-summary";
import { defaultLiveRecipient, recipientRowError } from "../live";

await GlobalRegistrator.register();
const recipient = defaultLiveRecipient.address;
const container = document.createElement("div");
container.innerHTML = renderToString(createElement(MoneyConfirmSummary, {
  amount: "$1.00",
  lead: "You're sending USDC",
  rows: [
    { label: "To", value: createElement(CopyableValue, { value: recipient, presentation: "full", valueKind: "address", className: "sm:justify-end" }), fullValue: true },
    { label: "Asset", value: "USDC" },
    { label: "Network", value: "Base" },
  ],
}));
const rows = [...container.querySelectorAll("dt")].map((labelNode) => ({
  label: labelNode.textContent ?? "",
  value: labelNode.nextElementSibling?.textContent ?? "",
}));
const reviewText = rows.map((row) => `${row.label}\n${row.value}`).join("\n");
const truncatedContainer = document.createElement("div");
truncatedContainer.innerHTML = renderToString(createElement(AddressText, { address: recipient }));
const truncatedValue = truncatedContainer.querySelector("button")?.textContent ?? "";
console.log(JSON.stringify({
  rows,
  renderedMatch: recipientRowError(reviewText, recipient),
  truncatedValue,
  truncatedMatch: recipientRowError(`To\n${truncatedValue}`, recipient),
}));
