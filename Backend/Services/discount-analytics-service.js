import mongoose from "mongoose";
import DiscountAnalytics from "../models/discount-analytics-model.js";
import Discount from "../models/discount-model.js";
import Order from "../models/order-model.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";
import { setCache } from "../utils/redis.js";

const BATCH_SIZE = 50;

// FIX: threshold now checked against usageHistory.length (total redemptions)
// rather than uniqueRedeemers.length (logged-in redeemers only).
// syncDiscountAfterRedemption fires at /validate time — before the Order
// document exists — so entry.user is null for many entries at that point.
// Filtering with .filter(e => e.user) undercounts redeemers and can keep
// the array below MIN_REDEMPTIONS_FOR_CONVERSION even when a code has been
// genuinely redeemed 3+ times, causing retention to stay null indefinitely.
const MIN_REDEMPTIONS_FOR_CONVERSION = 3;

const DAILY_SERIES_WINDOW_DAYS = 365;
const RETENTION_WINDOW_DAYS    = 90;

const CACHE_KEYS = {
  OVERVIEW:        "discount_analytics_overview",
  ROI_BY_CATEGORY: "discount_analytics_roi_by_category",
  ROI_BY_TYPE:     "discount_analytics_roi_by_type",
};

const invalidateAnalyticsCache = async () => {
  await Promise.allSettled(
    Object.values(CACHE_KEYS).map((key) =>
      setCache(key, null, 1).catch(() => {})
    )
  );
};

// ============================================
// SYNC SINGLE DISCOUNT
// ============================================

export const syncDiscountAnalytics = async (discountId) => {
  console.log(`[DA:sync] starting sync for discountId=${discountId}`);

  const discount = await Discount.findById(discountId).lean();
  if (!discount) {
    console.error(`[DA:sync] discount not found: ${discountId}`);
    throw new Error(`Discount ${discountId} not found`);
  }
  console.log(`[DA:sync] discount found: code=${discount.code} usageHistory.length=${discount.usageHistory?.length ?? 0}`);

  const matchedOrders = await Order.find({
    "discounts.codes.code": discount.code,
    "paymentInfo.status":   "success",
    orderStatus:            { $ne: "Cancelled" },
  })
    .select("user totalPrice discounts.codes discounts.totalDiscount createdAt")
    .lean();

  console.log(`[DA:sync] matchedOrders.length=${matchedOrders.length} for code=${discount.code}`);

  const usageHistory = discount.usageHistory ?? [];
  console.log(`[DA:sync] usageHistory.length=${usageHistory.length}`);

  const meta               = buildMeta(discount);
  const redemptionMetrics  = buildRedemptionMetrics(usageHistory);
  console.log(`[DA:sync] redemptionMetrics=`, JSON.stringify(redemptionMetrics));

const financials = buildFinancials(usageHistory, matchedOrders, discount.code);

financials.remainingBalance = discount.remainingBalance ?? null;
financials.originalValue    = discount.value ?? null;
financials.percentageExhausted =
  discount.value != null && discount.remainingBalance != null
    ? Math.round(((discount.value - discount.remainingBalance) / discount.value) * 100)
    : null;
  

  const conversion         = await buildConversion(discount, usageHistory, matchedOrders);
  const categoryBreakdown  = buildCategoryBreakdown(
    usageHistory,
    discount.conditions?.eligibleProductCategories ?? []
  );
  const segmentBreakdown   = await buildSegmentBreakdown(usageHistory);
  const valueTierBreakdown = await buildValueTierBreakdown(usageHistory);
  const dailyRedemptions   = buildDailyRedemptions(usageHistory, matchedOrders);
  const peakUsage          = derivePeakUsage(dailyRedemptions);
  const baseline           = await buildBaseline(financials.avgOrderValue);
  console.log(`[DA:sync] baseline=`, JSON.stringify(baseline));

  const { $inc, ...setFields } = {
    discountId:       discount._id,
    discountCode:     discount.code,
    meta,
    redemptions:      redemptionMetrics,
    financials,
    conversion,
    categoryBreakdown,
    segmentBreakdown,
    valueTierBreakdown,
    dailyRedemptions,
    peakUsage,
    baseline,
    lastSyncedAt:     new Date(),
    syncError:        false,
    syncErrorMessage: null,
    $inc: { syncCount: 1 },
  };

  const result = await DiscountAnalytics.findOneAndUpdate(
    { discountId: discount._id },
    { $set: setFields, $inc },
    { upsert: true, new: true, runValidators: true }
  );

  console.log(`[DA:sync] upsert complete. _id=${result._id} syncCount=${result.syncCount} redemptions.total=${result.redemptions?.total}`);
  return result;
};

// ============================================
// SYNC AFTER REDEMPTION (fire-and-forget hook)
// ============================================

export const syncDiscountAfterRedemption = async (discountCode) => {
  console.log(`[DA:afterRedemption] called for code=${discountCode}`);
  try {
    const discount = await Discount.findOne({
      code: discountCode.toUpperCase(),
    })
      .select("_id")
      .lean();

    if (!discount) {
      console.warn(`[DA:afterRedemption] discount not found for code=${discountCode}`);
      return;
    }

    console.log(`[DA:afterRedemption] found discountId=${discount._id}, triggering sync`);
    await syncDiscountAnalytics(discount._id);
    await invalidateAnalyticsCache();
    console.log(`[DA:afterRedemption] sync + cache invalidation complete for code=${discountCode}`);
  } catch (err) {
    console.error(`[DA:afterRedemption] swallowed error for code=${discountCode}:`, err?.message);
  }
};

// ============================================
// SYNC AFTER ORDER CREATED (discounted orders)
// ============================================

export const syncDiscountAfterOrderCreated = async (order) => {
  const codes = (order?.discounts?.codes ?? [])
    .map((c) => c.code)
    .filter(Boolean);

  console.log(`[DA:afterOrderCreated] orderId=${order?._id} codes=${JSON.stringify(codes)}`);

  if (codes.length === 0) {
    console.log(`[DA:afterOrderCreated] no discount codes on order, skipping`);
    return;
  }

  try {
    await Promise.allSettled(
      codes.map(async (code) => {
        const discount = await Discount.findOne({
          code: code.toUpperCase(),
        })
          .select("_id")
          .lean();

        if (!discount) {
          console.warn(`[DA:afterOrderCreated] discount not found for code=${code}`);
          return;
        }

        console.log(`[DA:afterOrderCreated] syncing discountId=${discount._id} for code=${code}`);
        await syncDiscountAnalytics(discount._id);
        console.log(`[DA:afterOrderCreated] sync complete for code=${code}`);
      })
    );

    await invalidateAnalyticsCache();
    console.log(`[DA:afterOrderCreated] cache invalidated for orderId=${order?._id}`);
  } catch (err) {
    console.error(`[DA:afterOrderCreated] swallowed error:`, err?.message);
  }
};

// ============================================
// SYNC BASELINE AFTER NON-DISCOUNTED ORDER
// ============================================


export const syncBaselineAfterNonDiscountedOrder = async () => {
  console.log(`[DA:baselineSync] non-discounted order placed — refreshing baseline for all codes`);
  try {
    // Compute the fresh store-wide baseline once
    const freshBaseline = await buildBaseline(null);
    console.log(`[DA:baselineSync] freshBaseline=`, JSON.stringify(freshBaseline));

    if (freshBaseline.storeAvgOrderValue === 0) {
      // No non-discounted successful orders found — nothing to update
      console.log(`[DA:baselineSync] storeAvgOrderValue still 0, skipping bulk update`);
      return;
    }

    // Bulk-update baseline.storeAvgOrderValue and baseline.storeAvgDiscountAmount
    // on all docs. We intentionally leave aovLiftPercent alone here because it
    // depends on each code's own avgOrderValue which we don't have without a
    // full sync. A subsequent manual Sync All or redemption-triggered sync will
    // update aovLiftPercent correctly per code.
    //
    // We do update aovLiftPercent for each document individually using their
    // stored financials.avgOrderValue so the lift is accurate right now.
    const allDocs = await DiscountAnalytics.find(
      {},
      { _id: 1, "financials.avgOrderValue": 1 }
    ).lean();

    console.log(`[DA:baselineSync] updating baseline for ${allDocs.length} analytics docs`);

    await Promise.allSettled(
      allDocs.map((doc) => {
        const codeAvgOrderValue = doc.financials?.avgOrderValue ?? 0;
        const aovLiftPercent =
          freshBaseline.storeAvgOrderValue > 0 && codeAvgOrderValue > 0
            ? roundCents(
                ((codeAvgOrderValue - freshBaseline.storeAvgOrderValue) /
                  freshBaseline.storeAvgOrderValue) *
                  100
              )
            : null;

        return DiscountAnalytics.findByIdAndUpdate(doc._id, {
          $set: {
            "baseline.storeAvgOrderValue":     freshBaseline.storeAvgOrderValue,
            "baseline.storeAvgDiscountAmount": freshBaseline.storeAvgDiscountAmount,
            "baseline.aovLiftPercent":         aovLiftPercent,
          },
        }).catch((err) => {
          console.error(`[DA:baselineSync] failed to update doc ${doc._id}:`, err?.message);
        });
      })
    );

    await invalidateAnalyticsCache();
    console.log(`[DA:baselineSync] baseline refresh complete for ${allDocs.length} docs`);
  } catch (err) {
    console.error(`[DA:baselineSync] swallowed error:`, err?.message);
  }
};

// ============================================
// BULK SYNC ALL DISCOUNTS
// ============================================

export const syncAllDiscountAnalytics = async () => {
  console.log(`[DA:bulkSync] starting bulk sync`);

  const discountIds = await Discount.find(
    { "usageLimit.currentUses": { $gt: 0 } },
    { _id: 1 }
  ).lean();

  const ids = discountIds.map((d) => d._id);
  console.log(`[DA:bulkSync] found ${ids.length} discounts with at least 1 use`);

  let successCount = 0;
  let errorCount   = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (discountId) => {
        try {
          await syncDiscountAnalytics(discountId);
          successCount++;
        } catch (err) {
          errorCount++;
          console.error(`[DA:bulkSync] error syncing discountId=${discountId}:`, err?.message);
          await DiscountAnalytics.findOneAndUpdate(
            { discountId },
            {
              $set: {
                syncError:        true,
                syncErrorMessage: err?.message ?? "Unknown error",
              },
            },
            { upsert: false }
          ).catch(() => {});
        }
      })
    );
  }

  await invalidateAnalyticsCache();
  console.log(`[DA:bulkSync] complete. total=${ids.length} success=${successCount} errors=${errorCount}`);

  return {
    total:      ids.length,
    successful: successCount,
    errors:     errorCount,
  };
};

// ============================================
// SUMMARY
// ============================================

export const getDiscountAnalyticsSummary = async () => {
  return DiscountAnalytics.getSummary();
};

// ============================================
// HELPERS
// ============================================

const buildMeta = (discount) => ({
  type:                      discount.type,
  value:                     discount.value,
  category:                  discount.category,
  audience:                  discount.audience,
  isCategoryRestricted:
    (discount.conditions?.eligibleProductCategories ?? []).length > 0,
  eligibleProductCategories:
    discount.conditions?.eligibleProductCategories ?? [],
  validFrom:      discount.validFrom,
  validUntil:     discount.validUntil,
  status:         discount.status,
  isCompensation:
    discount.category === "return" || discount.category === "refund",
});

const buildRedemptionMetrics = (usageHistory) => {
  if (usageHistory.length === 0) {
    return {
      total:            0,
      uniqueUsers:      0,
      firstTimeUsers:   0,
      returningUsers:   0,
      guestRedemptions: 0,
    };
  }

  const seenUserIds    = new Set();
  let guestRedemptions = 0;
  let firstTimeUsers   = 0;

  usageHistory.forEach((entry) => {
    const uid = entry.user?.toString();
    if (!uid) {
      guestRedemptions++;
      return;
    }
    if (!seenUserIds.has(uid)) {
      seenUserIds.add(uid);
      firstTimeUsers++;
    }
  });

  const loggedInRedemptions = usageHistory.length - guestRedemptions;
  const returningUsers      = loggedInRedemptions - firstTimeUsers;

  return {
    total:            usageHistory.length,
    uniqueUsers:      seenUserIds.size,
    firstTimeUsers,
    returningUsers:   Math.max(0, returningUsers),
    guestRedemptions,
  };
};

const buildFinancials = (usageHistory, matchedOrders, discountCode) => {
  const totalDiscountCost = roundCents(
    usageHistory.reduce((sum, e) => sum + (Number(e.discountAmount) || 0), 0)
  );

  const avgDiscountAmount =
    usageHistory.length > 0
      ? roundCents(totalDiscountCost / usageHistory.length)
      : 0;

  const totalRevenueInfluenced = roundCents(
    matchedOrders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0)
  );

  const avgOrderValue =
    matchedOrders.length > 0
      ? roundCents(totalRevenueInfluenced / matchedOrders.length)
      : 0;

  const roi =
    totalDiscountCost > 0
      ? roundCents(
          ((totalRevenueInfluenced - totalDiscountCost) / totalDiscountCost) * 100
        )
      : null;

  let totalEligibleSubtotal = null;
  if (discountCode) {
    const codeUpper   = discountCode.toUpperCase();
    const eligibleSum = matchedOrders.reduce((sum, o) => {
      const entry = (o.discounts?.codes ?? []).find(
        (c) => (c.code ?? "").toUpperCase() === codeUpper
      );
      return sum + (Number(entry?.amount) || 0);
    }, 0);
    if (eligibleSum > 0) {
      totalEligibleSubtotal = roundCents(eligibleSum);
    }
  }

  return {
    totalDiscountCost,
    avgDiscountAmount,
    totalRevenueInfluenced,
    avgOrderValue,
    roi,
    incrementalRevenue:    null,
    totalEligibleSubtotal,
  };
};

const buildConversion = async (discount, usageHistory, matchedOrders) => {
  const base = {
    postRedemptionRetentionRate: null,
    avgDaysToNextPurchase:       null,
    broadcastRedemptionRate:     null,
    targetedRedemptionRate:      null,
  };

  if (
    discount.audience === "specific" &&
    (discount.conditions?.eligibleUsers ?? []).length > 0
  ) {
    const eligibleCount   = discount.conditions.eligibleUsers.length;
    const uniqueRedeemers = new Set(
      usageHistory.filter((e) => e.user).map((e) => e.user.toString())
    ).size;

    base.targetedRedemptionRate = roundCents(
      Math.min((uniqueRedeemers / eligibleCount) * 100, 100)
    );
  }

  // FIX: gate on usageHistory.length not uniqueRedeemers.length.
  // At validate-time many entry.user values are null so filtering first
  // undercounts redeemers and permanently blocks retention from computing.
  const uniqueRedeemers = [
    ...new Set(
      usageHistory.filter((e) => e.user).map((e) => e.user.toString())
    ),
  ];

  if (usageHistory.length < MIN_REDEMPTIONS_FOR_CONVERSION) {
    return base;
  }

  // All redeemers were guests — cannot track cross-session retention.
  if (uniqueRedeemers.length === 0) {
    return base;
  }

  const firstRedemptionDate = new Map();
  usageHistory.forEach((entry) => {
    const uid    = entry.user?.toString();
    if (!uid) return;
    const usedAt = new Date(entry.usedAt);
    if (!firstRedemptionDate.has(uid) || usedAt < firstRedemptionDate.get(uid)) {
      firstRedemptionDate.set(uid, usedAt);
    }
  });

  const retentionCutoffs = uniqueRedeemers.map((uid) => {
    const redeemDate = firstRedemptionDate.get(uid);
    const windowEnd  = new Date(
      redeemDate.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    return { userId: uid, redeemDate, windowEnd };
  });

  const userObjectIds = uniqueRedeemers.map(
    (uid) => new mongoose.Types.ObjectId(uid)
  );

  const subsequentOrders = await Order.find({
    user:                 { $in: userObjectIds },
    "paymentInfo.status": "success",
    orderStatus:          { $ne: "Cancelled" },
    $or: [
      { "discounts.codes": { $exists: false } },
      { "discounts.codes": { $size: 0 } },
    ],
  })
    .select("user createdAt")
    .lean();

  const subsequentOrderMap = new Map();
  subsequentOrders.forEach((order) => {
    const uid = order.user.toString();
    if (!subsequentOrderMap.has(uid)) {
      subsequentOrderMap.set(uid, []);
    }
    subsequentOrderMap.get(uid).push(new Date(order.createdAt));
  });

  let retainedCount   = 0;
  let totalDaysToNext = 0;
  let daysToNextCount = 0;

  retentionCutoffs.forEach(({ userId, redeemDate, windowEnd }) => {
    const orders    = subsequentOrderMap.get(userId) ?? [];
    const nextOrder = orders
      .filter((d) => d > redeemDate && d <= windowEnd)
      .sort((a, b) => a - b)[0];

    if (nextOrder) {
      retainedCount++;
      const daysToNext = Math.floor(
        (nextOrder.getTime() - redeemDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      totalDaysToNext += daysToNext;
      daysToNextCount++;
    }
  });

  base.postRedemptionRetentionRate =
    uniqueRedeemers.length > 0
      ? roundCents((retainedCount / uniqueRedeemers.length) * 100)
      : null;

  base.avgDaysToNextPurchase =
    daysToNextCount > 0
      ? Math.round(totalDaysToNext / daysToNextCount)
      : null;

  return base;
};

const buildCategoryBreakdown = (usageHistory, eligibleCats = []) => {
  if (eligibleCats.length === 0) return [];

  const map = new Map();
  eligibleCats.forEach((cat) => {
    map.set(cat, { category: cat, redemptions: 0, discountCost: 0, revenueInfluenced: 0 });
  });

  usageHistory.forEach((entry) => {
    const costPerCat = (Number(entry.discountAmount) || 0) / eligibleCats.length;
    eligibleCats.forEach((cat) => {
      const rec = map.get(cat);
      rec.redemptions++;
      rec.discountCost = roundCents(rec.discountCost + costPerCat);
    });
  });

  return Array.from(map.values());
};

const buildSegmentBreakdown = async (usageHistory) => {
  const loggedInEntries = usageHistory.filter((e) => e.user);
  if (loggedInEntries.length === 0) return [];

  const userIds = [
    ...new Set(loggedInEntries.map((e) => e.user.toString())),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const analyticsResults = await CustomerAnalytics.find(
    { user: { $in: userIds } },
    { user: 1, "rfm.segment": 1 }
  ).lean();

  const segmentMap = new Map(
    analyticsResults.map((a) => [a.user.toString(), a.rfm?.segment ?? "Unknown"])
  );

  const breakdown = new Map();

  loggedInEntries.forEach((entry) => {
    const uid     = entry.user.toString();
    const segment = segmentMap.get(uid) ?? "Unknown";
    const savings = Number(entry.discountAmount) || 0;

    if (!breakdown.has(segment)) {
      breakdown.set(segment, {
        segment,
        redemptions:       0,
        totalSavings:      0,
        revenueInfluenced: 0,
      });
    }

    const rec = breakdown.get(segment);
    rec.redemptions++;
    rec.totalSavings = roundCents(rec.totalSavings + savings);
  });

  return Array.from(breakdown.values()).sort(
    (a, b) => b.redemptions - a.redemptions
  );
};

const buildValueTierBreakdown = async (usageHistory) => {
  const loggedInEntries = usageHistory.filter((e) => e.user);
  if (loggedInEntries.length === 0) return [];

  const userIds = [
    ...new Set(loggedInEntries.map((e) => e.user.toString())),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const analyticsResults = await CustomerAnalytics.find(
    { user: { $in: userIds } },
    { user: 1, valueTier: 1 }
  ).lean();

  const tierMap = new Map(
    analyticsResults.map((a) => [a.user.toString(), a.valueTier ?? "Unknown"])
  );

  const breakdown = new Map();

  loggedInEntries.forEach((entry) => {
    const uid     = entry.user.toString();
    const tier    = tierMap.get(uid) ?? "Unknown";
    const savings = Number(entry.discountAmount) || 0;

    if (!breakdown.has(tier)) {
      breakdown.set(tier, {
        tier,
        redemptions:       0,
        totalSavings:      0,
        revenueInfluenced: 0,
      });
    }

    const rec = breakdown.get(tier);
    rec.redemptions++;
    rec.totalSavings = roundCents(rec.totalSavings + savings);
  });

  return Array.from(breakdown.values()).sort(
    (a, b) => b.redemptions - a.redemptions
  );
};

const buildDailyRedemptions = (usageHistory, matchedOrders) => {
  const cutoff = new Date(
    Date.now() - DAILY_SERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const dayMap = new Map();

  const toDay = (date) => {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };

  usageHistory.forEach((entry) => {
    const usedAt = new Date(entry.usedAt);
    if (usedAt < cutoff) return;

    const day  = toDay(usedAt);
    const cost = Number(entry.discountAmount) || 0;

    if (!dayMap.has(day)) {
      dayMap.set(day, { date: new Date(`${day}T00:00:00.000Z`), redemptions: 0, discountCost: 0, revenueInfluenced: 0 });
    }
    const rec = dayMap.get(day);
    rec.redemptions++;
    rec.discountCost = roundCents(rec.discountCost + cost);
  });

  matchedOrders.forEach((order) => {
    const createdAt = new Date(order.createdAt);
    if (createdAt < cutoff) return;

    const day     = toDay(createdAt);
    const revenue = Number(order.totalPrice) || 0;

    if (!dayMap.has(day)) {
      dayMap.set(day, { date: new Date(`${day}T00:00:00.000Z`), redemptions: 0, discountCost: 0, revenueInfluenced: 0 });
    }
    const rec = dayMap.get(day);
    rec.revenueInfluenced = roundCents(rec.revenueInfluenced + revenue);
  });

  return Array.from(dayMap.values()).sort((a, b) => a.date - b.date);
};

const derivePeakUsage = (dailyRedemptions) => {
  if (dailyRedemptions.length === 0) {
    return { date: null, redemptions: 0, dayOfWeek: null };
  }

  const peak = dailyRedemptions.reduce((best, entry) =>
    entry.redemptions > best.redemptions ? entry : best
  );

  return {
    date:        peak.date,
    redemptions: peak.redemptions,
    dayOfWeek:   peak.redemptions > 0 ? new Date(peak.date).getUTCDay() : null,
  };
};

// buildBaseline accepts null for thisCodeAvgOrderValue when called from
// syncBaselineAfterNonDiscountedOrder — in that case aovLiftPercent is
// computed per-document in the caller rather than here.
const buildBaseline = async (thisCodeAvgOrderValue) => {
  const result = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus:          { $ne: "Cancelled" },
        $or: [
          { "discounts.codes": { $exists: false } },
          { "discounts.codes": { $size: 0 } },
        ],
      },
    },
    {
      $group: {
        _id:                    null,
        storeAvgOrderValue:     { $avg: "$totalPrice" },
        storeAvgDiscountAmount: { $avg: "$discounts.totalDiscount" },
      },
    },
  ]);

  const storeAvgOrderValue     = roundCents(result[0]?.storeAvgOrderValue     ?? 0);
  const storeAvgDiscountAmount = roundCents(result[0]?.storeAvgDiscountAmount ?? 0);

  const aovLiftPercent =
    storeAvgOrderValue > 0 && thisCodeAvgOrderValue > 0
      ? roundCents(
          ((thisCodeAvgOrderValue - storeAvgOrderValue) / storeAvgOrderValue) * 100
        )
      : null;

  return { storeAvgOrderValue, storeAvgDiscountAmount, aovLiftPercent };
};

// ============================================
// UTILITY
// ============================================

const roundCents = (n) => Math.round((n ?? 0) * 100) / 100;

// ============================================
// EXPORTS
// ============================================

export default {
  syncDiscountAnalytics,
  syncDiscountAfterRedemption,
  syncDiscountAfterOrderCreated,
  syncBaselineAfterNonDiscountedOrder,
  syncAllDiscountAnalytics,
  getDiscountAnalyticsSummary,
};