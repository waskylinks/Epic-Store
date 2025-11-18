import { now } from "mongoose";
import handleAsyncError from "../middleware/handleAsyncError.js";
import User from "../models/userModel.js";
import HandleError from "../utils/handleError.js";
import { sendToken } from "../utils/jwtToken.js";


export const registerUser = handleAsyncError(async (req, res, next) => {

    const { name, email, password } = req.body;

    const user = await User.create({
        name,
        email,
        password,
        avatar: {
            public_id: "this is a sample id",
            url: "profilepicUrl",
        }
    })

    //get token
    sendToken(user, 201, res);

});

//login user
export const loginUser = handleAsyncError(async (req, res, next) => {
    const { email, password } = req.body;

    //check if user has given password and email both
    if(!email || !password) {
        return next(new HandleError("Please enter email and password", 400));
    }

    const user = await User.findOne({ email }).select("+password");

    if(!user) {
        return next(new HandleError("Invalid email or password", 401));
    }

    // Check password
    const isPasswordMatched = await user.comparePassword(password);

    if (!isPasswordMatched) {
        return next(new HandleError("Invalid email or password", 401));
    }

    //get token
    sendToken(user, 200, res);

});

//logout function
export const logout = handleAsyncError(async(req, res, next) => {

    res.cookie('token', null, {
        expires: new Date(Date.now()),
        httpOnly: true
    })

    res.status(200).json({
        success: true,
        message:'Successfully logged out'
    })
})
