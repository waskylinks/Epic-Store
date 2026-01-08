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
      uppercase: true
    },

    paymentStatus: {
      type: String,
      enum: ["paid", "refunded", "pending"],
      default: "paid"
    },

    paidAt: { type: Date, default: Date.now }
  },
  { timestamps: true, strict: true }
);

receiptSchema.index({ user: 1 });
receiptSchema.index({ order: 1 });

receiptSchema.set("strictQuery", true);

export default mongoose.model("Receipt", receiptSchema);
