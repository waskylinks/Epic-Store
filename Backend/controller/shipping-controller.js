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
    const { address, city, state, country, zipCode, pinCode, phoneNo } = req.body;

    const errors = [];

    // Required fields
    if (!address || address.trim().length < 5) {
        errors.push('Address must be at least 5 characters');
    }

    if (!state || state.trim().length < 2) {
        errors.push('State is required');
    }

    if (!country || country.trim().length < 2) {
        errors.push('Country is required');
    }

    // Phone number validation — required for delivery contact
    if (!phoneNo) {
        errors.push('Phone number is required');
    } else {
        const cleanPhone = phoneNo.replace(/[\s\-\(\)]/g, '');
        if (cleanPhone.length < 10) {
            errors.push('Phone number must be at least 10 digits');
        }
    }

    // city    — optional (some countries have no city subdivisions)
    // pinCode — optional (many countries don't enforce postal codes)

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            isValid: false,
            errors
        });
    }

    const postalCode = zipCode || pinCode || '';

    return res.status(200).json({
        success: true,
        isValid: true,
        message: 'Address is valid',
        normalizedAddress: {
            address: address.trim(),
            city:    (city || '').trim(),
            state:   state.trim(),
            country: country.trim(),
            pinCode: postalCode.trim(),
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

    const addresses = await Address.find({ user: userId })
        .sort({ isDefault: -1, createdAt: -1 });

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
    const { name, phoneNo, address, city, state, country, zipCode, pinCode, isDefault } = req.body;

    // Required field validation
    if (!name || !phoneNo || !address || !state || !country) {
        return next(new HandleError('Name, phone, address, state and country are required', 400));
    }

    // city and pinCode are optional
    const postalCode = zipCode || pinCode || '';

    // If setting as default, unset other defaults first
    if (isDefault) {
        await Address.updateMany(
            { user: userId },
            { isDefault: false }
        );
    }

    const newAddress = await Address.create({
        user:      userId,
        name,
        phoneNo,
        address,
        city:      (city || '').trim(),
        state,
        country,
        pinCode:   postalCode,
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
    const { name, phoneNo, address, city, state, country, zipCode, pinCode, isDefault } = req.body;

    const existingAddress = await Address.findById(id);

    if (!existingAddress) {
        return next(new HandleError('Address not found', 404));
    }

    if (existingAddress.user.toString() !== userId.toString()) {
        return next(new HandleError('Unauthorized to update this address', 403));
    }

    if (isDefault) {
        await Address.updateMany(
            { user: userId, _id: { $ne: id } },
            { isDefault: false }
        );
    }

    const postalCode = zipCode || pinCode;

    const updatedAddress = await Address.findByIdAndUpdate(
        id,
        {
            name:      name      || existingAddress.name,
            phoneNo:   phoneNo   || existingAddress.phoneNo,
            address:   address   || existingAddress.address,
            city:      city      !== undefined ? city.trim()     : existingAddress.city,
            state:     state     || existingAddress.state,
            country:   country   || existingAddress.country,
            pinCode:   postalCode !== undefined ? postalCode.trim() : existingAddress.pinCode,
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

    if (address.user.toString() !== userId.toString()) {
        return next(new HandleError('Unauthorized to delete this address', 403));
    }

    await Address.findByIdAndDelete(id);

    if (address.isDefault) {
        const nextAddress = await Address.findOne({ user: userId })
            .sort({ createdAt: -1 });

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

    if (address.user.toString() !== userId.toString()) {
        return next(new HandleError('Unauthorized', 403));
    }

    await Address.updateMany(
        { user: userId },
        { isDefault: false }
    );

    address.isDefault = true;
    await address.save();

    return res.status(200).json({
        success: true,
        message: 'Default address updated',
        address
    });
});

/**
 * Get default address
 * @route GET /api/v1/shipping/address/default
 * @access Private
 */
export const getDefaultAddress = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;

    const address = await Address.findOne({
        user: userId,
        isDefault: true
    });

    if (!address) {
        return res.status(200).json({
            success: true,
            address: null,
            message: 'No default address set'
        });
    }

    return res.status(200).json({
        success: true,
        address
    });
});