import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { InvestExperience } from "@/client/invest/invest-experience";
import { getHomeQueryClient } from "@/client/query/query-client";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import { investMarketHandlers } from "./explorations/invest-market.fixtures";

function InvestSearchJourney() {
  return <main className={`${shellContentFrameClassName} py-4`}><InvestExperience /></main>;
}

const meta = {
  title: "Journeys/Invest Search",
  component: InvestSearchJourney,
  beforeEach: () => { window.history.replaceState(null, "", window.location.href); getHomeQueryClient().clear(); },
  parameters: {
    layout: "fullscreen",
    msw: { handlers: [
      http.get("/api/invest/search", ({ request }) => {
        const query = new URL(request.url).searchParams.get("q") ?? "";
        return query === "unavailable" ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(searchFixture(query));
      }),
      ...investMarketHandlers,
    ] },
  },
} satisfies Meta<typeof InvestSearchJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Journey: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const input = await screen.findByRole("textbox", { name: "Search assets" });
    await userEvent.clear(input);
    await expect(screen.getByRole("heading", { name: "Stocks" })).toBeVisible();
    await userEvent.type(input, "ORB");
    const row = (await screen.findAllByRole("button", { name: /Orbit/ }))[0]!;
    await expect(within(row).getAllByText(/0x1111…1111/)[0]).toBeVisible();
    await userEvent.click(row);
    await expect(await screen.findByRole("heading", { name: "Orbit" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search assets" })).toHaveValue("ORB"));
    await expect((await screen.findAllByRole("button", { name: /Orbit/ }))[0]).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await expect(screen.getByRole("heading", { name: "Stocks" })).toBeVisible();
  },
};

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const input = await screen.findByRole("textbox", { name: "Search assets" });
    await userEvent.clear(input);
    await userEvent.type(input, "nothing-found");
    await expect((await screen.findAllByText("No results"))[1]).toBeVisible();
  },
};

export const Error: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const input = await screen.findByRole("textbox", { name: "Search assets" });
    await userEvent.clear(input);
    await userEvent.type(input, "unavailable");
    await expect((await screen.findAllByText("Search unavailable"))[1]).toBeVisible();
    await expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  },
};

export const Partial: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const input = await screen.findByRole("textbox", { name: "Search assets" });
    await userEvent.clear(input);
    await userEvent.type(input, "partial");
    await expect((await screen.findAllByRole("button", { name: /Orbit/ }))[0]).toBeVisible();
    await expect(screen.getByText("Some results couldn’t load.")).toBeVisible();
  },
};

export const MobileKeyboard: Story = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const input = await screen.findByRole("textbox", { name: "Search assets" });
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.type(input, "Apple");
    await expect((await screen.findAllByRole("button", { name: /Apple/ }))[0]).toBeVisible();
    await expect(input).toHaveFocus();
  },
};
