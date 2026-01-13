import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    shippingInfo: {
      address: String,
      city: String,
      state: String,
      country: String,
      pinCode: String, // Changed from Number to String for international postal codes
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

    // Gateway-specific payment metadata
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

    // Refund tracking
    refundInfo: {
      status: {
        type: String,
        enum: ["none", "requested", "processing", "completed", "failed"],
        default: "none"
      },
      amount: {
        type: Number,
        default: 0
      },
      reason: String,
      refundReference: String,
      requestedAt: Date,
      processedAt: Date,
      refundedAt: Date,
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

    deliveredAt: Date
  },
  { timestamps: true, strict: true }
);

// Indexes for query performance
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ "paymentInfo.reference": 1 });
orderSchema.index({ "paymentInfo.status": 1 });
orderSchema.index({ "paymentInfo.method": 1 });
orderSchema.index({ "refundInfo.status": 1 });

// Virtual for checking if order is refundable
orderSchema.virtual("isRefundable").get(function() {
  return (
    this.paymentInfo.status === "success" &&
    this.refundInfo.status === "none" &&
    this.orderStatus !== "Cancelled"
  );
});

// Virtual for partial refund amount
orderSchema.virtual("refundableAmount").get(function() {
  return this.amountPaid - this.refundInfo.amount;
});

// Ensure virtuals are included in JSON/Object conversions
orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });
orderSchema.set("strictQuery", true);

export default mongoose.model("Order", orderSchema);