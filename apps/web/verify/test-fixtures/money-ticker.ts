import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MoneyTicker } from "../../components/money-ticker";
import { parseUsdAmount } from "../live";

await GlobalRegistrator.register();
const container = document.createElement("div");
container.innerHTML = renderToString(createElement(MoneyTicker, { value: "$1.00", animated: false }));
const renderedText = container.innerText || container.textContent || "";
console.log(JSON.stringify({ renderedText, parsedAmount: parseUsdAmount(renderedText) }));
