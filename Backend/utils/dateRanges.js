export const getDateRanges = (timeframe) => {
  const now = new Date();
  let currentPeriodStart, previousPeriodStart, previousPeriodEnd;

  if (timeframe === "day") {
    // Current period: Today from 00:00:00
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    
    // Previous period: Yesterday from 00:00:00
    previousPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    
    // Previous period end: Yesterday at 23:59:59
    previousPeriodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    
  } else if (timeframe === "week") {
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    previousPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
    previousPeriodEnd = currentPeriodStart;
    
  } else if (timeframe === "year") {
    currentPeriodStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    previousPeriodStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    previousPeriodEnd = currentPeriodStart;
    
  } else {
    // Default: month
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    previousPeriodStart = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
    previousPeriodEnd = currentPeriodStart;
  }

  return { currentPeriodStart, previousPeriodStart, previousPeriodEnd };
};