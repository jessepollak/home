// Route contract.
// POST /api/funding/webhooks/:provider

export type FundingWebhookResponse = {
  accepted: true;
  matched?: boolean;
};
