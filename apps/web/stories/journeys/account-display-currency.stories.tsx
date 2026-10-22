import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, type ReactNode } from "react";
import { HttpResponse, http } from "msw";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { AccountSettings } from "@/client/account/account-settings";
import { useHomeRegion } from "@/client/home/use-home-region";
import { PresentationRegionProvider, usePresentationScope } from "@/client/invest/presentation-quote";
import { countryRegionIds, type CountryCode, type RegionOffer } from "@/config/regions";
import type { DisplayCurrencyChoice } from "@/shared/account/display-currency";
import { presentationCurrencyName } from "@/shared/formatting/presentation-fiat";
import { accountAppearanceAddress, createInviteFetcher, type InviteState } from "./explorations/account-appearance-fixture";

type JourneyProps = {
  country: CountryCode | null;
  savedCurrency?: string | null;
  preferencePending?: boolean;
  failFirstCurrencyWrite?: boolean;
  documentDirection?: "rtl";
  documentTextScale?: "200%";
  noCountryOffer?: boolean;
  inviteState?: InviteState;
  onCurrencyWrite: (choice: DisplayCurrencyChoice, adopt: boolean) => void;
  onCountryWrite: (country: CountryCode, adopt: boolean) => void;
};

function PresentationProbe() {
  const scope = usePresentationScope();
  return <p data-testid="presentation-scope">{`${scope.region} formatting · ${scope.currency ?? "no currency"} valuations`}</p>;
}

function DocumentFixture({ direction, textScale, children }: { direction?: "rtl"; textScale?: "200%"; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previousDirection = root.getAttribute("dir");
    const previousSize = root.style.fontSize;
    if (direction) root.dir = direction;
    if (textScale) root.style.fontSize = textScale;
    return () => {
      if (previousDirection === null) root.removeAttribute("dir");
      else root.dir = previousDirection;
      root.style.fontSize = previousSize;
    };
  }, [direction, textScale]);
  return children;
}

const globalOffer: RegionOffer = { offered: countryRegionIds, defaultRegion: "GLOBAL" };

function DisplayCurrencyJourney({
  country,
  savedCurrency = null,
  preferencePending = false,
  failFirstCurrencyWrite = false,
  documentDirection,
  documentTextScale,
  noCountryOffer = false,
  inviteState = "loaded",
  onCurrencyWrite,
  onCountryWrite,
}: JourneyProps) {
  const currencyWrites = useRef(0);
  const region = useHomeRegion({
    detectedCountry: null,
    accountPreference: country,
    accountDisplayCurrency: savedCurrency,
    accountIdentity: "display-currency-story",
    accountOwner: "display-currency-story",
    accountPreferencePending: preferencePending,
    offer: noCountryOffer ? globalOffer : undefined,
    signedIn: true,
    accountReady: true,
    writeAccountPreference: async (next, adopt) => {
      onCountryWrite(next, adopt);
      return next;
    },
    writeAccountDisplayCurrency: async (choice, adopt) => {
      currencyWrites.current += 1;
      onCurrencyWrite(choice, adopt);
      if (failFirstCurrencyWrite && currencyWrites.current === 1) throw new Error("Preference write unavailable");
      return choice;
    },
  });
  return (
    <DocumentFixture direction={documentDirection} textScale={documentTextScale}>
      <main className="mx-auto w-full max-w-160 p-4">
        <PresentationRegionProvider regionId={region.regionId} currency={region.displayCurrency.currency}>
          <PresentationProbe />
        </PresentationRegionProvider>
        <AccountSettings
          regionId={region.regionId}
          onRegionChange={region.selectRegion}
          offeredCountries={region.offeredCountries}
          resolutionSource={region.resolutionSource}
          preferenceMessage={region.preferenceMessage}
          isPreferenceReady={region.isPreferenceReady}
          displayCurrency={region.displayCurrency}
          onDisplayCurrencyChange={region.selectDisplayCurrency}
          displayCurrencyMessage={region.displayCurrencyMessage}
          displayCurrencyWriteFailed={region.displayCurrencyWriteFailed}
          onRetryDisplayCurrencyWrite={region.retryDisplayCurrencyWrite}
          accountAddress={accountAppearanceAddress}
          accountOwnerKey="display-currency-story"
          accountSessionOwnerKey={"cdp-embedded\u0000display-currency-story"}
          fetchAccountResource={createInviteFetcher(inviteState)}
          showSmallBalances={false}
          onShowSmallBalancesChange={() => {}}
          appearancePreference="light"
          onAppearancePreferenceChange={() => true}
          onSignOut={() => {}}
        />
      </main>
    </DocumentFixture>
  );
}

const meta = {
  id: "journeys-account-display-currency",
  title: "Journeys/Account display currency",
  component: DisplayCurrencyJourney,
  args: { country: "BR", onCurrencyWrite: fn(), onCountryWrite: fn() },
  beforeEach: () => {
    window.localStorage.clear();
  },
  parameters: {
    a11y: { test: "error" },
    viewport: { defaultViewport: "mobile" },
    msw: { handlers: [
      http.get("https://api.ensideas.com/*", () => HttpResponse.json({ name: "display-currency.base.eth" })),
    ] },
  },
} satisfies Meta<typeof DisplayCurrencyJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = within(document.body);

function currencyRow(canvasElement: HTMLElement) {
  const trigger = within(canvasElement).getByRole("combobox", { name: "Display currency" });
  const row = trigger.closest<HTMLElement>("[data-slot='item']") ?? canvasElement;
  return { trigger, row: within(row) };
}

async function chooseCurrency(canvasElement: HTMLElement, optionName: string) {
  const { trigger } = currencyRow(canvasElement);
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  const listbox = await page.findByRole("listbox");
  const target = within(listbox).getByRole("option", { name: optionName });
  const options = within(listbox).getAllByRole("option");
  const targetIndex = options.indexOf(target);
  for (let step = 0; step < 60 && !target.hasAttribute("data-highlighted"); step += 1) {
    const current = options.findIndex((option) => option.hasAttribute("data-highlighted"));
    await userEvent.keyboard(current > targetIndex ? "{ArrowUp}" : "{ArrowDown}");
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
  await expect(target).toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{Enter}");
  await waitForReady(() => expect(page.queryByRole("listbox")).toBeNull());
}

async function chooseCountry(canvasElement: HTMLElement, label: string) {
  const input = within(canvasElement).getByRole("combobox", { name: "Country" });
  await userEvent.tripleClick(input);
  await userEvent.keyboard(label);
  if (!page.queryByRole("listbox")) await userEvent.keyboard("{ArrowDown}");
  const option = await page.findByRole("option", { name: label });
  for (let step = 0; step < 30 && !option.hasAttribute("data-highlighted"); step += 1) {
    await userEvent.keyboard("{ArrowDown}");
  }
  await userEvent.keyboard("{Enter}");
  await waitForReady(() => expect(input).toHaveValue(label));
}

async function expectScope(canvasElement: HTMLElement, text: string) {
  await waitForReady(() => expect(within(canvasElement).getByTestId("presentation-scope")).toHaveTextContent(text));
}

export const CountryDefault: Story = {
  play: async ({ canvasElement, args }) => {
    const { trigger, row } = currencyRow(canvasElement);
    await expect(trigger).toHaveTextContent(presentationCurrencyName("BRL"));
    await expect(trigger).toBeEnabled();
    await expect(row.getByText("Country default")).toBeVisible();
    await expectScope(canvasElement, "BR formatting · BRL valuations");
    await expect(args.onCurrencyWrite).not.toHaveBeenCalled();
  },
};

export const PinCountryCurrency: Story = {
  play: async ({ canvasElement, args }) => {
    await chooseCurrency(canvasElement, presentationCurrencyName("BRL"));
    await expect(currencyRow(canvasElement).row.getByText("Chosen by you")).toBeVisible();
    await waitForReady(() => expect(args.onCurrencyWrite).toHaveBeenCalledWith("BRL", false));
    await chooseCountry(canvasElement, "United States");
    await expectScope(canvasElement, "US formatting · BRL valuations");
    await expect(currencyRow(canvasElement).row.getByText("Chosen by you")).toBeVisible();
  },
};

export const ChooseUsdThenChangeCountry: Story = {
  play: async ({ canvasElement, args }) => {
    await chooseCurrency(canvasElement, presentationCurrencyName("USD"));
    const { trigger, row } = currencyRow(canvasElement);
    await expect(row.getByText("Chosen by you")).toBeVisible();
    await expect(trigger).toHaveTextContent(presentationCurrencyName("USD"));
    await expect(trigger).toHaveFocus();
    await expectScope(canvasElement, "BR formatting · USD valuations");
    await waitForReady(() => expect(args.onCurrencyWrite).toHaveBeenCalledOnce());
    await expect(args.onCurrencyWrite).toHaveBeenCalledWith("USD", false);
    await expect(await row.findByText("Display currency saved to your account.")).toBeVisible();

    await chooseCountry(canvasElement, "United States");
    await expectScope(canvasElement, "US formatting · USD valuations");
    await expect(currencyRow(canvasElement).row.getByText("Chosen by you")).toBeVisible();

    await chooseCountry(canvasElement, "Nigeria");
    await expectScope(canvasElement, "NG formatting · USD valuations");
    await expect(currencyRow(canvasElement).row.getByText("Chosen by you")).toBeVisible();
    await expect(currencyRow(canvasElement).trigger).toHaveTextContent(presentationCurrencyName("USD"));
    await expect(args.onCountryWrite).toHaveBeenCalledWith("NG", false);
    await expect(args.onCurrencyWrite).toHaveBeenCalledOnce();
  },
};

export const ReturnToCountryDefault: Story = {
  args: { savedCurrency: "USD" },
  play: async ({ canvasElement, args }) => {
    await expect(currencyRow(canvasElement).row.getByText("Chosen by you")).toBeVisible();
    await chooseCurrency(canvasElement, `Country default (${presentationCurrencyName("BRL")})`);
    await expect(currencyRow(canvasElement).row.getByText("Country default")).toBeVisible();
    await expectScope(canvasElement, "BR formatting · BRL valuations");
    await waitForReady(() => expect(args.onCurrencyWrite).toHaveBeenCalledWith("country-default", false));

    await chooseCountry(canvasElement, "Nigeria");
    await expectScope(canvasElement, "NG formatting · NGN valuations");
    await expect(currencyRow(canvasElement).trigger).toHaveTextContent(presentationCurrencyName("NGN"));
    await expect(currencyRow(canvasElement).row.getByText("Country default")).toBeVisible();
  },
};

export const EscapeKeepsChoice: Story = {
  play: async ({ canvasElement, args }) => {
    const { trigger } = currencyRow(canvasElement);
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const listbox = await page.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}");
    await waitForReady(() => expect(listbox).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitForReady(() => expect(page.queryByRole("listbox")).toBeNull());
    await waitForReady(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent(presentationCurrencyName("BRL"));
    await expect(currencyRow(canvasElement).row.getByText("Country default")).toBeVisible();
    await expectScope(canvasElement, "BR formatting · BRL valuations");
    await expect(args.onCurrencyWrite).not.toHaveBeenCalled();
  },
};

export const SaveFailedRetry: Story = {
  args: { failFirstCurrencyWrite: true },
  play: async ({ canvasElement, args }) => {
    await chooseCurrency(canvasElement, presentationCurrencyName("USD"));
    const { row } = currencyRow(canvasElement);
    await expect(await row.findByText("Display currency changed for this visit only. Could not save to your account.")).toBeVisible();
    await expectScope(canvasElement, "BR formatting · USD valuations");
    const retry = within(canvasElement).getByRole("button", { name: "Try again" });
    retry.focus();
    await userEvent.keyboard("{Enter}");
    await expect(await row.findByText("Display currency saved to your account.")).toBeVisible();
    await waitForReady(() => expect(within(canvasElement).queryByRole("button", { name: "Try again" })).toBeNull());
    await expect(args.onCurrencyWrite).toHaveBeenCalledTimes(2);
    await expect(args.onCurrencyWrite).toHaveBeenLastCalledWith("USD", false);
  },
};

export const WithdrawnSavedCurrency: Story = {
  args: { savedCurrency: "ZWL" },
  play: async ({ canvasElement, args }) => {
    const { trigger, row } = currencyRow(canvasElement);
    await expect(row.getByText("Your saved currency (ZWL) is no longer offered.")).toBeVisible();
    await expect(row.getByText("Country default")).toBeVisible();
    await expect(trigger).toHaveTextContent(presentationCurrencyName("BRL"));
    await expectScope(canvasElement, "BR formatting · BRL valuations");
    await expect(args.onCurrencyWrite).not.toHaveBeenCalled();
  },
};

export const PreferenceChecking: Story = {
  args: { preferencePending: true },
  play: async ({ canvasElement }) => {
    const { trigger, row } = currencyRow(canvasElement);
    await expect(trigger).toBeDisabled();
    await expect(row.getByRole("status")).toHaveTextContent("Checking saved country preference.");
  },
};

export const NoCountryDefault: Story = {
  args: { country: null, noCountryOffer: true },
  play: async ({ canvasElement }) => {
    const { trigger, row } = currencyRow(canvasElement);
    await expect(trigger).toHaveTextContent("No currency yet");
    await expect(row.getByText("Country default")).toBeVisible();
    await expectScope(canvasElement, "GLOBAL formatting · no currency valuations");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const listbox = await page.findByRole("listbox");
    await waitForReady(() => expect(within(listbox).getByRole("option", { name: "Country default" })).toBeVisible());
    await userEvent.keyboard("{Escape}");
  },
};

async function expectFitsWidth(canvasElement: HTMLElement) {
  const { trigger } = currencyRow(canvasElement);
  await expect(trigger).toBeVisible();
  const root = canvasElement.ownerDocument.documentElement;
  const rowElement = trigger.closest<HTMLElement>("[data-slot='item']");
  if (!rowElement) throw new Error("Display currency row is missing");
  await expect(rowElement.scrollWidth).toBeLessThanOrEqual(rowElement.clientWidth);
  const rect = trigger.getBoundingClientRect();
  await expect(rect.left).toBeGreaterThanOrEqual(0);
  await expect(rect.right).toBeLessThanOrEqual(root.clientWidth);
}

export const LargeTextNarrow: Story = {
  args: { savedCurrency: "USD", documentTextScale: "200%", inviteState: "unavailable" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  globals: { viewport: { value: "smallMobile" } },
  play: async ({ canvasElement }) => {
    await expectFitsWidth(canvasElement);
    await chooseCurrency(canvasElement, `Country default (${presentationCurrencyName("BRL")})`);
    await expectFitsWidth(canvasElement);
  },
};

export const RightToLeftNarrow: Story = {
  args: { country: "NG", savedCurrency: "GBP", documentDirection: "rtl", inviteState: "unavailable" },
  parameters: { viewport: { defaultViewport: "mobile" } },
  globals: { viewport: { value: "mobile" } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute("dir", "rtl");
    await expect(currencyRow(canvasElement).row.getByText("Chosen by you")).toBeVisible();
    await expectFitsWidth(canvasElement);
    await chooseCurrency(canvasElement, presentationCurrencyName("USD"));
    await expectScope(canvasElement, "NG formatting · USD valuations");
    await expectFitsWidth(canvasElement);
  },
};
