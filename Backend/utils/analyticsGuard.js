import HandleError from "./handleError.js";

// FIX: Original threw HandleError when result was empty — this is wrong for analytics.
// An empty array is a valid result (e.g., no orders today). Throwing 500 would crash
// the dashboard on a slow day. Use these helpers correctly:
//
//   assertAggregationResult  → reserved for truly unexpected failures (result is not array / null)
//   safeAggFirst             → safely extract [0] with a fallback default
//   safeAggSum               → safely sum a field across all results with fallback

/**
 * Asserts the DB returned a proper array (not null/undefined).
 * Does NOT throw on empty array — that's a valid state.
 * Throws only when the aggregation itself appears to have errored (null/non-array returned).
 *
 * @param {any} result - Value returned by Model.aggregate(...)
 * @param {string} context - Label for error messages
 */
export const assertAggregationResult = (result, context) => {
  if (!Array.isArray(result)) {
    throw new HandleError(
      `Analytics aggregation returned non-array result: ${context}`,
      500
    );
  }
  // Empty array is VALID — no data in period. Callers must handle [].
};

/**
 * Safely returns the first element of an aggregation result,
 * or a default object if the array is empty.
 *
 * @param {Array} result - Aggregation result
 * @param {Object} fallback - Default value when result is empty
 * @returns {Object}
 */
export const safeAggFirst = (result, fallback = {}) => {
  assertAggregationResult(result, "safeAggFirst");
  return result.length > 0 ? result[0] : fallback;
};

/**
 * Safely sums a numeric field across all aggregation results.
 *
 * @param {Array} result - Aggregation result
 * @param {string} field - Field name to sum
 * @param {number} fallback - Default when result is empty
 * @returns {number}
 */
export const safeAggSum = (result, field, fallback = 0) => {
  assertAggregationResult(result, `safeAggSum(${field})`);
  return result.reduce((acc, doc) => acc + (doc[field] || 0), fallback);
};