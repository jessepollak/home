import { priceObservationStoreContract } from "./price-observation-store.contract";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";

let store = new MemoryPriceObservationStore();
priceObservationStoreContract({
  name: "Memory",
  createStore: () => store,
  reset: () => { store = new MemoryPriceObservationStore(); },
});
