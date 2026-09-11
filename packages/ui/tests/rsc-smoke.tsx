// Executed in a separate process with React's server export condition.
import { strict as assert } from "node:assert";
import { Button, Heading, IconButton, Text } from "@home/ui";
import { PlusIcon } from "@home/ui/icons";

assert.equal(typeof globalThis.window, "undefined");
assert.equal(Text({ children: "Server text" }).type, "p");
assert.equal(Heading({ level: 4, children: "Server heading" }).type, "h4");
assert.equal(Button({ children: "Server button" }).type, "button");
assert.equal(IconButton({ icon: PlusIcon, "aria-label": "Server action" }).type, Button);
console.log("Core and Phosphor SSR exports load under react-server without DOM or client context.");
