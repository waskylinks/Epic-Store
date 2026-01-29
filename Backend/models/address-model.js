import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  phoneNo: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Nigerian phone number validation
        const cleanPhone = v.replace(/[\s\-\(\)]/g, '');
        return /^(\+234|234|0)[7-9][0-1]\d{8}$/.test(cleanPhone);
      },
      message: 'Invalid phone number format'
    }
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
    minlength: [5, 'Address must be at least 5 characters'],
    maxlength: [200, 'Address cannot exceed 200 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    minlength: [2, 'City must be at least 2 characters'],
    maxlength: [50, 'City cannot exceed 50 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    minlength: [2, 'State must be at least 2 characters'],
    maxlength: [50, 'State cannot exceed 50 characters']
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    default: 'Nigeria',
    maxlength: [50, 'Country cannot exceed 50 characters']
  },
  pinCode: {
    type: String,
    required: [true, 'Postal code is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Nigerian postal code (6 digits)
        return /^\d{6}$/.test(v);
      },
      message: 'Invalid postal code format (must be 6 digits)'
    }
  },
  isDefault: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for user queries
addressSchema.index({ user: 1, isDefault: -1 });

// Ensure only one default address per user
addressSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { 
        user: this.user, 
        _id: { $ne: this._id } 
      },
      { isDefault: false }
    );
  }
  next();
});

// Update the updatedAt timestamp
addressSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Address = mongoose.model('Address', addressSchema);

export default Address;