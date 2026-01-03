import HandleError from "../utils/handleError.js";
import { TIMEFRAMES } from "../constants/analytics.constants.js";

export const validateTimeframe = (timeframe) => {
  if (!TIMEFRAMES.includes(timeframe)) {
    throw new HandleError("Invalid timeframe", 400);
  }
};
