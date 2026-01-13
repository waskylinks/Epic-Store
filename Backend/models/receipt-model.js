import mongoose from "mongoose";

const receiptSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    reference: {
      type: String,
      required: true,
      unique: true
    },

    customer: {
      name: String,
      email: String,
      phoneNo: String
    },

    // Shipping information snapshot
    shippingInfo: {
      address: String,
      city: String,
      state: String,
      country: String,
      pinCode: String
    },

    orderItems: [
      {
        name: String,
        quantity: Number,
        price: Number
      }
    ],

    itemPrice: Number,
    taxPrice: Number,
    shippingPrice: Number,
    totalPrice: Number,

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      required: true
    },

    // Payment gateway used for this transaction
    paymentGateway: {
      type: String,
      enum: ["paystack", "flutterwave", "stripe", "manual"],
      required: true
    },

    paymentStatus: {
      type: String,
      enum: ["paid", "refunded", "partially_refunded", "pending"],
      default: "paid"
    },

    // Gateway-specific receipt metadata
    receiptMeta: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // Refund tracking in receipt
    refundInfo: {
      amount: {
        type: Number,
        default: 0
      },
      reason: String,
      refundedAt: Date
    },

    paidAt: { 
      type: Date, 
      default: Date.now 
    }
  },
  { timestamps: true, strict: true }
);

// Indexes for query performance
receiptSchema.index({ user: 1, createdAt: -1 });
receiptSchema.index({ order: 1 });
receiptSchema.index({ reference: 1 });
receiptSchema.index({ paymentGateway: 1 });
receiptSchema.index({ paymentStatus: 1 });

// Virtual for checking if receipt has been refunded
receiptSchema.virtual("isRefunded").get(function() {
  return this.paymentStatus === "refunded" || this.paymentStatus === "partially_refunded";
});

// Virtual for net amount (after refunds)
receiptSchema.virtual("netAmount").get(function() {
  return this.totalPrice - (this.refundInfo.amount || 0);
});

// Ensure virtuals are included in JSON/Object conversions
receiptSchema.set("toJSON", { virtuals: true });
receiptSchema.set("toObject", { virtuals: true });
receiptSchema.set("strictQuery", true);

export default mongoose.model("Receipt", receiptSchema);