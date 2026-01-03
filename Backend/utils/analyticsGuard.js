import HandleError from "./handleError.js";

export const assertAggregationResult = (result, context) => {
  if (!Array.isArray(result) || result.length === 0) {
    throw new HandleError(
      `Analytics aggregation failed or returned empty result: ${context}`,
      500
    );
  }
};
