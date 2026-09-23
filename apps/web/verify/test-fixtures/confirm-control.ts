import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MoneyTicker } from "../../components/money-ticker";
import { MONEY_ACTION_ID_ATTRIBUTE } from "../../shared/money-actions";
import { confirmControlScript, protectedControlScript } from "../action";
import { refVisibleNameScript } from "../live";

await GlobalRegistrator.register();
const id = "11111111-1111-4111-8111-111111111111";
document.body.innerHTML = renderToString(createElement("button", { type: "button", [MONEY_ACTION_ID_ATTRIBUTE]: id },
  "Send ", createElement(MoneyTicker, { value: "$0.10", animated: false })));
const control = document.querySelector("button");
if (!control) throw new Error("The money control did not render.");
Object.defineProperty(control, "getClientRects", { value: () => [{}] });
const evaluate = (script: string): unknown => new Function(`return ${script}`)() as unknown;
const result = {
  confirm: evaluate(confirmControlScript(MONEY_ACTION_ID_ATTRIBUTE)),
  protected: evaluate(protectedControlScript(MONEY_ACTION_ID_ATTRIBUTE, "Send $0.10")),
  incorrectName: evaluate(protectedControlScript(MONEY_ACTION_ID_ATTRIBUTE, "Send $0.10$.")),
  ref: evaluate(refVisibleNameScript(control.innerHTML, null)),
};
control.setAttribute("aria-label", "Send USDC");
console.log(JSON.stringify({
  ...result,
  labelledConfirm: evaluate(confirmControlScript(MONEY_ACTION_ID_ATTRIBUTE)),
  labelledProtected: evaluate(protectedControlScript(MONEY_ACTION_ID_ATTRIBUTE, "Send USDC")),
  labelledRef: evaluate(refVisibleNameScript(control.innerHTML, "Send USDC")),
}));
await GlobalRegistrator.unregister();
