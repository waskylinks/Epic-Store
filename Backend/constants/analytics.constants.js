export const TIMEFRAMES = ["day", "week", "month", "year"];

export const ORDER_STATUSES = {
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled"
};

export const INVENTORY_STATUSES = {
  IN_STOCK: "InStock",
  LOW_STOCK: "LowStock",
  OUT_OF_STOCK: "OutOfStock",
  DISCONTINUED: "Discontinued"
};

export const CACHE_TTL = {
  SHORT: 180,   // 3 min — alerts, live data
  DEFAULT: 300, // 5 min — most analytics
  LONG: 600     // 10 min — cohorts, slow-changing data
};