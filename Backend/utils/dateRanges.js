export const getDateRanges = (timeframe) => {
  const now = new Date();
  let currentPeriodStart, previousPeriodStart, previousPeriodEnd;

  if (timeframe === "week") {
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    previousPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
  } else if (timeframe === "year") {
    currentPeriodStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    previousPeriodStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  } else {
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    previousPeriodStart = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
  }

  previousPeriodEnd = currentPeriodStart;

  return { currentPeriodStart, previousPeriodStart, previousPeriodEnd };
};
