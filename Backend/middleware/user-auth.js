import HandleError from '../utils/handleError.js';
import handleAsyncError from './handleAsyncError.js'
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

export const verifyUserAuth = handleAsyncError(async (req, res, next) => {
    const { token } = req.cookies;

    if (!token) {
        return next(new HandleError('Authentication is missing! Please log in to access resource', 401));
    }

    const decodedData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.user = await User.findById(decodedData.id).select(
        "+lastSeenDiscountsAt +createdAt +firstName +lastName +email +role +avatar+phone +dateOfBirth +gender"
    );

    next();
});

export const roleBaseAccess = (...roles) => {
    return (req, res, next) => {
        if(!roles.includes(req.user.role)) {
            return next(new HandleError(`Role - ${req.user.role} is not allowed to access this resource`, 403))
        }
        next();
    }
}

export const requireCompleteProfile = (req, res, next) => {
  const { phone, dateOfBirth, gender } = req.user;
  if (!phone || !dateOfBirth || !gender) {
    return next(new HandleError('Please complete your profile before proceeding', 403));
  }
  next();
};

