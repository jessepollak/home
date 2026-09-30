import { createPortal } from "react-dom";

export default function Dialog() {
  return createPortal(<p>Escaped imported overlay</p>, document.body);
}
