import handleAsyncError from './handleAsyncError.js'

export const verifyUserAuth = handleAsyncError(async (req, res, next) => {
    const token = req.cookies;
    console.log(token);

});