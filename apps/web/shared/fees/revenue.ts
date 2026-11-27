export type OperatorRevenueDay = { date: string; collectedBaseUnits: string };

export type OperatorRevenueSummary = {
  collectedBaseUnits: string;
  days: OperatorRevenueDay[];
  recorded: boolean;
};
