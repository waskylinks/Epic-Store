import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    shippingInfo: {
      address: String,
      city: String,
      state: String,
      country: String,
      pinCode: String,
      phoneNo: String
    },

    orderItems: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true
        },
        name: String,
        price: Number,
        quantity: Number,
        image: String
      }
    ],

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    paymentInfo: {
      reference: { type: String, required: true, unique: true },
      providerTxId: String,
      stripePaymentIntentId: String,
      status: {
        type: String,
        enum: ["pending", "success", "failed"],
        default: "pending"
      },
      method: {
        type: String,
        enum: ["paystack", "flutterwave", "stripe", "manual"],
        required: true
      },
      currency: { 
        type: String, 
        default: "NGN",
        uppercase: true
      },
      amount: Number,
      paidAt: Date
    },

    paymentMeta: {
      channel: String,
      ipAddress: String,
      customer: {
        type: mongoose.Schema.Types.Mixed
      },
      authorization: {
        type: mongoose.Schema.Types.Mixed
      },
      cardDetails: {
        last4: String,
        brand: String,
        expMonth: Number,
        expYear: Number
      },
      raw: {
        type: mongoose.Schema.Types.Mixed
      }
    },

    // ✅ FIXED: Complete refund tracking
    refundInfo: {
      status: {
        type: String,
        enum: ["none", "requested", "approved", "rejected", "processing", "completed", "failed"],
        default: "none"
      },
      
      // Request details
      reason: String,
      description: String,
      refundType: {
        type: String,
        enum: ["full", "partial"],
        default: "full"
      },
      requestedAmount: Number,
      requestedAt: Date,
      requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      
      // Review details
      approvedAt: Date,
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      rejectedAt: Date,
      rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      adminNote: String,
      
      // Processing details
      refundId: String,
      refundAmount: Number,
      refundCurrency: String,
      processedAt: Date,
      processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      refundedAt: Date,
      
      // Gateway response
      gatewayResponse: {
        type: mongoose.Schema.Types.Mixed
      },
      
      // Failure handling
      failureReason: String,
      
      // Legacy fields
      amount: { type: Number, default: 0 },
      refundReference: String,
      notes: String
    },

    itemPrice: Number,
    taxPrice: Number,
    shippingPrice: Number,
    totalPrice: Number,
    amountPaid: Number,

    orderStatus: {
      type: String,
      enum: ["Processing", "Shipped", "Delivered", "Cancelled"],
      default: "Processing"
    },

    deliveredAt: Date,
    cancelledAt: Date,
    cancellationReason: String
  },
  { timestamps: true, strict: true }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ "paymentInfo.status": 1 });
orderSchema.index({ "paymentInfo.method": 1 });
orderSchema.index({ "refundInfo.status": 1 });
orderSchema.index({ "paymentInfo.reference": 1 });

// Virtuals
orderSchema.virtual("isRefundable").get(function() {
  return (
    this.paymentInfo.status === "success" &&
    this.refundInfo.status === "none" &&
    this.orderStatus !== "Cancelled"
  );
});

orderSchema.virtual("refundableAmount").get(function() {
  return this.amountPaid - (this.refundInfo.refundAmount || 0);
});

orderSchema.virtual("daysUntilRefundDeadline").get(function() {
  const REFUND_WINDOW_DAYS = 30;
  const baseDate = this.deliveredAt || this.paymentInfo.paidAt;
  if (!baseDate) return null;
  const deadline = new Date(baseDate);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  const daysRemaining = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysRemaining);
});

orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });
orderSchema.set("strictQuery", true);

export default mongoose.model("Order", orderSchema);