# Cash-out actions · selected F

Jesse selected **F · Labelled Send** with “F please!” on the cash-out action comparison for [#1045](https://github.com/jessepollak/home/issues/1045).

Accepted revision: `explorations-cash-out-actions--f-labelled-send`, with its existing `f-mobile`, `f-narrow`, `f-tablet`, `f-desktop`, RTL and state frames on `review-boards--cash-out-actions`. The board, story IDs and unselected A–E proposals remain review evidence.

## Adoption

Production Home uses primary **Plus + Add money**, outline **Landmark + Cash out**, and outline **paper-plane + Send** at the row end. DOM and keyboard order are Add money → Cash out → Send. Intrinsic equal-height grid rows preserve the selected wrapping fallback at narrow widths and enlarged text. Send off retains the main pair with a single Cash out trigger.

The existing funding link, transfer route entry, account-owner boundary, offering policy, history and dialogs remain in place. This adoption changes only action presentation and placement; it adds no transaction or lifecycle behavior.

Production story parity is recorded by `Journeys/Home money actions` (Selected and Send off), using HomePanel and the saved product offering provider. The cash-out entry browser regression verifies independent Send/Cash out routes, keyboard activation, Close focus restoration and no dispatch. Fixture evidence does not establish live-provider availability, real-money execution or full localization.
