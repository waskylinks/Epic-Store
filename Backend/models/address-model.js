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
        // E.164: + followed by 7–15 digits
        return /^\+[1-9]\d{6,14}$/.test(v.replace(/[\s\-\(\)]/g, ''));
      },
      message: 'Phone number must be in international format (e.g. +2348012345678)'
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
    required: false,   // optional — some countries have no city subdivisions
    trim: true,
    maxlength: [100, 'City cannot exceed 100 characters'],
    default: ''
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    minlength: [2, 'State must be at least 2 characters'],
    maxlength: [100, 'State cannot exceed 100 characters']
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    maxlength: [100, 'Country cannot exceed 100 characters']
  },
  pinCode: {
    type: String,
    required: false,   // optional — many countries (e.g. Nigeria) don't enforce postal codes
    trim: true,
    maxlength: [20, 'Postal code cannot exceed 20 characters'],
    default: ''
  },
  isDefault: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true
});

addressSchema.index({ user: 1, isDefault: -1 });

addressSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { user: this.user, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

const Address = mongoose.model('Address', addressSchema);

export default Address;