export const sendToken = (user, statusCode, res) => {
    const token = user.getJWTToken();

    //option for cookies
    const options = {
        expires: new Date(
            Date.now() + process.env.COOKIE_EXPIRES_TIME * 24 * 60 * 60 * 1000
        ),
        httpOnly: true,
        sameSite: 'lax',                                          
        secure: process.env.NODE_ENV === 'production' ? true : false,
    }

    res.status(statusCode).cookie(
        'token',
        token,
        options
        
    ).json({
        success: true,
        user,
        token,  
    })
};
