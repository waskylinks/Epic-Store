import mongoose from "mongoose";

// Define the Receipt schema
const receiptSchema = new mongoose.Schema(
  {
    // Reference to the related order
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true
    },

    // Reference to the user who made the order
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // Unique payment reference (used for idempotency)
    reference: {
      type: String,
      required: true,
      unique: true
    },

    // Snapshot of customer info at time of purchase
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phoneNo: { type: String, required: true }
    },

    // Array of ordered items
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true }
      }
    ],

    // Price breakdown for accounting
    itemPrice: { type: Number, required: true },      // subtotal
    taxPrice: { type: Number, required: true },       // tax
    shippingPrice: { type: Number, required: true },  // shipping
    totalPrice: { type: Number, required: true },     // grand total

    // 💵 Currency (hard-defaulted to NGN for receipts)
    currency: {
      type: String,
      default: "NGN",
      trim: true,
      uppercase: true
    },

    // Shipping information
    shippingInfo: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String },
      phoneNo: { type: String, required: true },
      country: { type: String, default: "Nigeria" } // optional for future scaling
    },

    // Payment info
    paymentStatus: {
      type: String,
      enum: ["paid", "refunded", "pending"],
      default: "paid"
    },
    paymentGateway: {
      type: String,
      default: "paystack"
    },
    paidAt: {
      type: Date,
      default: Date.now
    },

    // Optional: human-readable invoice number
    invoiceNumber: { type: String }
  },
  { timestamps: true }
);

// Indexes for fast queries
receiptSchema.index({ user: 1 });
receiptSchema.index({ order: 1 });

export default mongoose.model("Receipt", receiptSchema);
