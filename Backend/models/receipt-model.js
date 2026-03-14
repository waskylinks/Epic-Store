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

    itemPrice:    Number,
    taxPrice:     Number,
    shippingPrice: Number,
    totalPrice:   Number,

    // FIX: discount snapshot for receipt display and PDF generation.
    // Previously absent — receipts and PDFs showed the discounted subtotal
    // with no explanation of why it was lower than the sum of line items,
    // and createReceiptIfNotExists never forwarded discount data here.
    discount: {
      code:           { type: String, default: null },
      discountAmount: { type: Number, default: 0    },
      type:           { type: String, default: null },  // 'percentage' | 'fixed'
      originalItemPrice: { type: Number, default: null }, // gross before discount
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      required: true
    },

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

    receiptMeta: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {}
    },

    refundInfo: {
      amount:     { type: Number, default: 0 },
      reason:     String,
      refundedAt: Date
    },

    paidAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true, strict: true }
);

receiptSchema.index({ user: 1, createdAt: -1 });
receiptSchema.index({ order: 1 });
receiptSchema.index({ paymentGateway: 1 });
receiptSchema.index({ paymentStatus: 1 });

receiptSchema.virtual("isRefunded").get(function () {
  return this.paymentStatus === "refunded" || this.paymentStatus === "partially_refunded";
});

receiptSchema.virtual("netAmount").get(function () {
  return this.totalPrice - (this.refundInfo.amount || 0);
});

receiptSchema.set("toJSON",   { virtuals: true });
receiptSchema.set("toObject", { virtuals: true });
receiptSchema.set("strictQuery", true);

export default mongoose.model("Receipt", receiptSchema);