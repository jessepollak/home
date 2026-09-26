# Money confirmation

- A confirm step renders `MoneyConfirmFooter` with its prepared action, never a bare `MoneyModalFooter`. Only the primary control carries `data-money-action-id` (`MONEY_ACTION_ID_ATTRIBUTE` in `shared/money-actions`), and only while that action is unexpired. Agents must check this marker with `agent-browser get attr @ref data-money-action-id` before any click.
