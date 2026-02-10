/**
 * Calculate date ranges for analytics queries
 * Returns current period and previous period for comparison
 * 
 * @param {string} timeframe - 'day', 'week', 'month', or 'year'
 * @returns {Object} { currentPeriodStart, previousPeriodStart, previousPeriodEnd }
 */
export const getDateRanges = (timeframe) => {
  const now = new Date();
  let currentPeriodStart, previousPeriodStart, previousPeriodEnd;

  switch (timeframe) {
    case "day":
      // Current period: Today from 00:00:00
      currentPeriodStart = new Date(now);
      currentPeriodStart.setHours(0, 0, 0, 0);
      
      // Previous period: Yesterday from 00:00:00 to 23:59:59
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 1);
      
      // Previous period end: Yesterday at 23:59:59
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1); // One millisecond before current period
      break;

    case "week":
      // Current period: Last 7 days
      currentPeriodStart = new Date(now);
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 7);
      currentPeriodStart.setHours(0, 0, 0, 0);
      
      // Previous period: 14 days ago to 7 days ago
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 7);
      
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;

    case "year":
      // Current period: Last 365 days
      currentPeriodStart = new Date(now);
      currentPeriodStart.setFullYear(currentPeriodStart.getFullYear() - 1);
      currentPeriodStart.setHours(0, 0, 0, 0);
      
      // Previous period: 2 years ago to 1 year ago
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setFullYear(previousPeriodStart.getFullYear() - 1);
      
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;

    case "month":
    default:
      // Current period: Last 30 days
      currentPeriodStart = new Date(now);
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 30);
      currentPeriodStart.setHours(0, 0, 0, 0);
      
      // Previous period: 60 days ago to 30 days ago
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 30);
      
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      break;
  }

  return {
    currentPeriodStart,
    previousPeriodStart,
    previousPeriodEnd
  };
};

/**
 * Get human-readable date range label
 * 
 * @param {string} timeframe - 'day', 'week', 'month', or 'year'
 * @returns {string} Human-readable label
 */
export const getDateRangeLabel = (timeframe) => {
  const labels = {
    day: 'Today vs Yesterday',
    week: 'Last 7 days vs Previous 7 days',
    month: 'Last 30 days vs Previous 30 days',
    year: 'Last 365 days vs Previous 365 days'
  };
  
  return labels[timeframe] || labels.month;
};

/**
 * Format date for display
 * 
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
export const formatDateDisplay = (date) => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};