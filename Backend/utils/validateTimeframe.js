import HandleError from "../utils/handleError.js";
import { TIMEFRAMES } from "../constants/analytics.constants.js";

export const validateTimeframe = (timeframe, next) => {
  if (!TIMEFRAMES.includes(timeframe)) {
    return next(new HandleError("Invalid timeframe", 400));
  }
};
