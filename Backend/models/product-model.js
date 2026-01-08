import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true },
    ratings: { type: Number, default: 0 },

    images: [
      {
        public_id: String,
        url: String
      }
    ],

    category: { type: String, required: true },
    stock: { type: Number, default: 1 },
    numOfReviews: { type: Number, default: 0 },

    reviews: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        name: String,
        rating: Number,
        comment: String,
        createdAt: { type: Date, default: Date.now }
      }
    ],

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true, strict: true }
);

productSchema.index({ createdAt: -1 });
productSchema.index({ stock: 1 });

productSchema.set("strictQuery", true);

export default mongoose.model("Product", productSchema);
