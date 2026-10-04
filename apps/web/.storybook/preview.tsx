import type { Preview } from "@storybook/nextjs-vite";
import { setupWorker } from "msw/browser";
import { mswLoader } from "msw-storybook-addon/csf3";
import { ProductOfferingProvider } from "@/client/home/product-offering";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import {
  getHomeQueryClient,
  HomeQueryClientProvider,
} from "@/client/query/query-client";
import "@/app/globals.css";
import { rejectUnexpectedStoryRequest } from "./request-guard";

const deploymentOffering = resolveProductOffering({ kind: "deployment" });

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Home appearance",
      toolbar: {
        title: "Theme",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle("dark", context.globals.theme === "dark");
      document.body.style.backgroundColor = "var(--background)";
      const story = (
        <PresentationRegionProvider regionId="GLOBAL">
          <Story />
        </PresentationRegionProvider>
      );
      return (
        <HomeQueryClientProvider>
          {context.parameters.provideProductOffering === false ? story : (
            <ProductOfferingProvider value={deploymentOffering}>
              {story}
            </ProductOfferingProvider>
          )}
        </HomeQueryClientProvider>
      );
    },
  ],
  loaders: [
    mswLoader(async () => {
      const worker = setupWorker();
      await worker.start({
        onUnhandledRequest(request) {
          rejectUnexpectedStoryRequest(request, globalThis.location.origin);
        },
      });
      return worker;
    }),
  ],
  beforeEach() {
    getHomeQueryClient().clear();
    return () => {
      getHomeQueryClient().clear();
      document.documentElement.classList.remove("dark");
    };
  },
  parameters: {
    nextjs: {
      appDirectory: true,
    },
    // Review boards sort first in the sidebar; everything else keeps configure order.
    options: {
      storySort: { order: ["Review", ["Boards"]] },
    },
    // Every story test runs the a11y addon's checks. Violations are reported as
    // warnings (`todo`) so the gate fails on behavior, not on pre-existing
    // product findings that need their own product decision; audit-clean
    // workshop stories opt into `error` in their own meta.
    a11y: {
      test: "todo",
      // Base UI renders visually hidden, aria-hidden focus guards around open
      // popups to wrap focus; they are intentional sentinels, not content.
      config: {
        rules: [
          {
            id: "aria-hidden-focus",
            selector: "[aria-hidden=\"true\"]:not([data-base-ui-focus-guard])",
          },
        ],
      },
    },
    viewport: {
      viewports: {
        smallMobile: {
          name: "Small mobile (320px)",
          styles: { width: "320px", height: "568px" },
        },
        mobile: {
          name: "Mobile (390px)",
          styles: { width: "390px", height: "844px" },
        },
        label375: {
          name: "Mobile (375px)",
          styles: { width: "375px", height: "812px" },
        },
        label430: {
          name: "Mobile (430px)",
          styles: { width: "430px", height: "932px" },
        },
        desktop: {
          name: "Desktop (1280px)",
          styles: { width: "1280px", height: "800px" },
        },
      },
    },
  },
};

export default preview;
