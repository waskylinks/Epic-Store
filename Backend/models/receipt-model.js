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
      unique: true // Mongoose creates a unique index
    },

    // Array of ordered items
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true }
      }
    ],

    // Total price for the order
    totalPrice: {
      type: Number,
      required: true
    },

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
      phoneNo: { type: String, required: true }
    }
  },
  { timestamps: true }
);

// Index for faster user-based queries
receiptSchema.index({ user: 1 });

export default mongoose.model("Receipt", receiptSchema);
