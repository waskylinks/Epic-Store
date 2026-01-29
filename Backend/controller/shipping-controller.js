import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Address from '../models/address-model.js';

// ============================================
// ADDRESS VALIDATION
// ============================================

/**
 * Validate shipping address format
 * @route POST /api/v1/shipping/validate-address
 * @access Public
 */
export const validateAddress = handleAsyncError(async (req, res, next) => {
    const { address, city, state, country, pinCode, phoneNo } = req.body;

    const errors = [];

    // Required field validation
    if (!address || address.trim().length < 5) {
        errors.push('Address must be at least 5 characters');
    }

    if (!city || city.trim().length < 2) {
        errors.push('City is required');
    }

    if (!state || state.trim().length < 2) {
        errors.push('State is required');
    }

    if (!country || country.trim().length < 2) {
        errors.push('Country is required');
    }

    // Postal code validation (Nigeria)
    if (!pinCode) {
        errors.push('Postal code is required');
    } else if (country === 'Nigeria' && !/^\d{6}$/.test(pinCode)) {
        errors.push('Invalid Nigerian postal code (must be 6 digits)');
    }

    // Phone number validation (Nigeria)
    if (!phoneNo) {
        errors.push('Phone number is required');
    } else {
        const cleanPhone = phoneNo.replace(/[\s\-\(\)]/g, '');
        
        // Nigerian phone number patterns
        const nigerianPatterns = [
            /^(\+234|234|0)[7-9][0-1]\d{8}$/,  // Format: +234XXXXXXXXXX or 0XXXXXXXXXX
        ];

        const isValidNigerian = nigerianPatterns.some(pattern => pattern.test(cleanPhone));

        if (country === 'Nigeria' && !isValidNigerian) {
            errors.push('Invalid Nigerian phone number format');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            isValid: false,
            errors
        });
    }

    return res.status(200).json({
        success: true,
        isValid: true,
        message: 'Address is valid',
        normalizedAddress: {
            address: address.trim(),
            city: city.trim(),
            state: state.trim(),
            country: country.trim(),
            pinCode: pinCode.trim(),
            phoneNo: phoneNo.trim()
        }
    });
});

// ============================================
// SAVED ADDRESSES MANAGEMENT
// ============================================

/**
 * Get all saved addresses for user
 * @route GET /api/v1/shipping/addresses
 * @access Private
 */
export const getSavedAddresses = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;

    const addresses = await Address.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 });

    return res.status(200).json({
        success: true,
        count: addresses.length,
        addresses
    });
});

/**
 * Save new address
 * @route POST /api/v1/shipping/address
 * @access Private
 */
export const saveAddress = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;
    const { name, phoneNo, address, city, state, country, pinCode, isDefault } = req.body;

    // Validate required fields
    if (!name || !phoneNo || !address || !city || !state || !country || !pinCode) {
        return next(new HandleError('All address fields are required', 400));
    }

    // If setting as default, unset other defaults first
    if (isDefault) {
        await Address.updateMany(
            { user: userId },
            { isDefault: false }
        );
    }

    const newAddress = await Address.create({
        user: userId,
        name,
        phoneNo,
        address,
        city,
        state,
        country,
        pinCode,
        isDefault: isDefault || false
    });

    return res.status(201).json({
        success: true,
        message: 'Address saved successfully',
        address: newAddress
    });
});

/**
 * Update address
 * @route PUT /api/v1/shipping/address/:id
 * @access Private
 */
export const updateAddress = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;
    const { id } = req.params;
    const { name, phoneNo, address, city, state, country, pinCode, isDefault } = req.body;

    const existingAddress = await Address.findById(id);

    if (!existingAddress) {
        return next(new HandleError('Address not found', 404));
    }

    // Check ownership
    if (existingAddress.user.toString() !== userId.toString()) {
        return next(new HandleError('Unauthorized to update this address', 403));
    }

    // If setting as default, unset other defaults first
    if (isDefault) {
        await Address.updateMany(
            { user: userId, _id: { $ne: id } },
            { isDefault: false }
        );
    }

    const updatedAddress = await Address.findByIdAndUpdate(
        id,
        {
            name: name || existingAddress.name,
            phoneNo: phoneNo || existingAddress.phoneNo,
            address: address || existingAddress.address,
            city: city || existingAddress.city,
            state: state || existingAddress.state,
            country: country || existingAddress.country,
            pinCode: pinCode || existingAddress.pinCode,
            isDefault: isDefault !== undefined ? isDefault : existingAddress.isDefault
        },
        { new: true, runValidators: true }
    );

    return res.status(200).json({
        success: true,
        message: 'Address updated successfully',
        address: updatedAddress
    });
});

/**
 * Delete address
 * @route DELETE /api/v1/shipping/address/:id
 * @access Private
 */
export const deleteAddress = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;
    const { id } = req.params;

    const address = await Address.findById(id);

    if (!address) {
        return next(new HandleError('Address not found', 404));
    }

    // Check ownership
    if (address.user.toString() !== userId.toString()) {
        return next(new HandleError('Unauthorized to delete this address', 403));
    }

    await Address.findByIdAndDelete(id);

    // If deleted address was default, set another as default
    if (address.isDefault) {
        const nextAddress = await Address.findOne({ user: userId }).sort({ createdAt: -1 });
        if (nextAddress) {
            nextAddress.isDefault = true;
            await nextAddress.save();
        }
    }

    return res.status(200).json({
        success: true,
        message: 'Address deleted successfully'
    });
});

/**
 * Set address as default
 * @route PUT /api/v1/shipping/address/:id/default
 * @access Private
 */
export const setDefaultAddress = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;
    const { id } = req.params;

    const address = await Address.findById(id);

    if (!address) {
        return next(new HandleError('Address not found', 404));
    }

    // Check ownership
    if (address.user.toString() !== userId.toString()) {
        return next(new HandleError('Unauthorized', 403));
    }

    // Unset all other defaults
    await Address.updateMany(
        { user: userId },
        { isDefault: false }
    );

    // Set this one as default
    address.isDefault = true;
    await address.save();

    return res.status(200).json({
        success: true,
        message: 'Default address updated',
        address
    });
});