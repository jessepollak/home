import { describeUserTokenStore } from "./testing/describeUserTokenStore";
import { MemoryFundingProviderUserTokenStore } from "./user-token-store";
const store = new MemoryFundingProviderUserTokenStore();
describeUserTokenStore("memory funding provider token store", () => store, async (key) => JSON.stringify(await store.get(key)));
