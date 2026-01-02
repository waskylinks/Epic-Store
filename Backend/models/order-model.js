import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    shippingInfo: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
      pinCode: { type: Number, required: true },
      phoneNo: { type: String, required: true }
    },

    orderItems: [
      {
        product: {
          type: mongoose.Schema.ObjectId,
          ref: "Product",
          required: true
        },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true },
        image: { type: String, required: true }
      }
    ],

    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true
    },

    //------------------------------------------------------------------
    // PAYMENT CORE (multi-gateway, multi-currency, idempotent)
    //------------------------------------------------------------------
    paymentInfo: {
      reference: {
        type: String,
        required: true,
        unique: true // prevents duplicate orders per transaction
      },
      providerTxId: { type: String }, // paystack id / stripe charge id / flutterwave id
      status: {
        type: String,
        enum: ["pending", "success", "failed"],
        required: true
      },
      method: {
        type: String,
        enum: ["paystack", "flutterwave", "stripe", "manual"],
        required: true
      },
      currency: { type: String, default: "NGN" },
      amount: { type: Number, required: true },
      paidAt: { type: Date }
    },

    //------------------------------------------------------------------
    // PRICING BREAKDOWN
    //------------------------------------------------------------------
    itemPrice: { type: Number, required: true, default: 0 },
    taxPrice: { type: Number, required: true, default: 0 },
    shippingPrice: { type: Number, required: true, default: 0 },
    totalPrice: { type: Number, required: true, default: 0 },
    amountPaid: { type: Number, required: true, default: 0 },

    //------------------------------------------------------------------
    // ORDER LIFECYCLE
    
    orderStatus: {
      type: String,
      enum: ["Processing", "Shipped", "Delivered", "Cancelled"],
      default: "Processing"
    },

    deliveredAt: Date,

    //------------------------------------------------------------------
    // PAYMENT METADATA (raw provider data)
    //------------------------------------------------------------------
    paymentMeta: {
      channel: String,     
      currency: String,    
      ipAddress: String,   
      customer: Object,    
      authorization: Object,  
      raw: Object // Paystack/Flutterwave/Stripe verified payload
    }
  },
  { timestamps: true }
);

//------------------------------------------------------------------
// OTHER UNIQUE INDEXES
//------------------------------------------------------------------
orderSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Order", orderSchema);
