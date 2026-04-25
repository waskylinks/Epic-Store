export const getDateRanges = (timeframe) => {
  const now = new Date();
  let currentPeriodStart, previousPeriodStart, previousPeriodEnd;

  switch (timeframe) {
    case "day":
      currentPeriodStart = new Date(now);
      currentPeriodStart.setHours(0, 0, 0, 0);
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 1);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;
    case "week": {
      const dayOfWeek = now.getDay(); // 0 = Sunday
      currentPeriodStart = new Date(now);
      currentPeriodStart.setDate(now.getDate() - dayOfWeek);
      currentPeriodStart.setHours(0, 0, 0, 0);
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 7);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;
    }
    case "year":
      currentPeriodStart = new Date(now);
      currentPeriodStart.setFullYear(currentPeriodStart.getFullYear() - 1);
      currentPeriodStart.setHours(0, 0, 0, 0);
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setFullYear(previousPeriodStart.getFullYear() - 1);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;
    case "month":
    default:
      currentPeriodStart = new Date(now);
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 30);
      currentPeriodStart.setHours(0, 0, 0, 0);
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 30);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;
  }

  return { currentPeriodStart, previousPeriodStart, previousPeriodEnd };
};

export const getDateGroupFormat = (groupBy, dateField = "$createdAt") => {
  switch (groupBy) {
    case "hour":
      return { $dateToString: { format: "%Y-%m-%d %H:00", date: dateField } };
    case "week":
      return { $dateToString: { format: "%Y-W%V", date: dateField } };
    case "month":
      return { $dateToString: { format: "%Y-%m", date: dateField } };
    default:
      return { $dateToString: { format: "%Y-%m-%d", date: dateField } };
  }
};

export const getDateRangeLabel = (timeframe) => {
  const labels = {
    day: "Today vs Yesterday",
    week: "This week vs Last week",
    month: "Last 30 days vs Previous 30 days",
    year: "Last 365 days vs Previous 365 days"
  };
  return labels[timeframe] || labels.month;
};

export const formatDateDisplay = (date) =>
  date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });