import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    shippingInfo: {
      address: String,
      city: String,
      state: String,
      country: String,
      pinCode: Number,
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
        enum: ["pending", "success", "failed"]
      },
      method: {
        type: String,
        enum: ["paystack", "flutterwave", "stripe", "manual"]
      },
      currency: { type: String, default: "NGN" },
      amount: Number,
      paidAt: Date
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

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

orderSchema.set("strictQuery", true);

export default mongoose.model("Order", orderSchema);
