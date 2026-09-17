import type { Preview } from "@storybook/nextjs-vite";
import { setupWorker } from "msw/browser";
import { mswLoader } from "msw-storybook-addon/csf3";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import {
  getHomeQueryClient,
  HomeQueryClientProvider,
} from "@/client/query/query-client";
import "@/app/globals.css";
import { rejectUnexpectedStoryRequest } from "./request-guard";

const preview: Preview = {
  decorators: [
    (Story) => (
      <HomeQueryClientProvider>
        <PresentationRegionProvider regionId="GLOBAL">
          <Story />
        </PresentationRegionProvider>
      </HomeQueryClientProvider>
    ),
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
    };
  },
  parameters: {
    nextjs: {
      appDirectory: true,
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
        desktop: {
          name: "Desktop (1280px)",
          styles: { width: "1280px", height: "800px" },
        },
      },
    },
  },
};

export default preview;
