/**
 * Email Templates for Authentication System
 * Professional, responsive HTML email templates
 */

const getEmailWrapper = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EpicStore</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 30px 20px;
            text-align: center;
            color: #ffffff;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
        }
        .content {
            padding: 40px 30px;
            color: #333333;
            line-height: 1.6;
        }
        .content h2 {
            color: #667eea;
            margin-top: 0;
            font-size: 24px;
        }
        .code-box {
            background-color: #f8f9fa;
            border: 2px dashed #667eea;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            margin: 25px 0;
        }
        .code {
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            color: #667eea;
            font-family: 'Courier New', monospace;
        }
        .button {
            display: inline-block;
            padding: 14px 32px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 20px 0;
            transition: transform 0.2s;
        }
        .footer {
            background-color: #f8f9fa;
            padding: 25px 30px;
            text-align: center;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #e0e0e0;
        }
        .footer a {
            color: #667eea;
            text-decoration: none;
        }
        .warning {
            background-color: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
            color: #856404;
        }
        .info-box {
            background-color: #e7f3ff;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
            color: #0c5460;
        }
        @media only screen and (max-width: 600px) {
            .container {
                margin: 10px;
            }
            .content {
                padding: 25px 20px;
            }
            .code {
                font-size: 24px;
                letter-spacing: 4px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛍️ EpicStore</h1>
        </div>
        ${content}
        <div class="footer">
            <p>This email was sent from EpicStore</p>
            <p>If you didn't request this email, please ignore it or <a href="#">contact support</a></p>
            <p style="margin-top: 15px; color: #999;">
                &copy; ${new Date().getFullYear()} EpicStore. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
`;

export const emailTemplates = {
    /**
     * Email Verification Template
     */
    verificationEmail: (name, code) => ({
        subject: 'Verify Your Email - EpicStore',
        text: `Hi ${name},\n\nThank you for registering with EpicStore!\n\nYour verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't create an account, please ignore this email.\n\nBest regards,\nThe EpicStore Team`,
        html: getEmailWrapper(`
            <div class="content">
                <h2>Welcome to EpicStore! 🎉</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>Thank you for registering with EpicStore. We're excited to have you on board!</p>
                <p>To complete your registration, please verify your email address using the code below:</p>
                
                <div class="code-box">
                    <div style="color: #666; font-size: 14px; margin-bottom: 10px;">Your Verification Code</div>
                    <div class="code">${code}</div>
                    <div style="color: #999; font-size: 12px; margin-top: 10px;">Expires in 10 minutes</div>
                </div>
                
                <div class="info-box">
                    <strong>💡 Tip:</strong> Copy and paste this code into the verification page to activate your account.
                </div>
                
                <div class="warning">
                    <strong>⚠️ Security Notice:</strong> If you didn't create an account with EpicStore, please ignore this email. Your information is safe.
                </div>
            </div>
        `)
    }),

    /**
     * Welcome Email Template (after verification)
     */
    welcomeEmail: (name) => ({
        subject: 'Welcome to EpicStore! 🎊',
        text: `Hi ${name},\n\nYour email has been successfully verified!\n\nWelcome to EpicStore - your ultimate shopping destination. Start exploring amazing products and exclusive deals.\n\nHappy Shopping!\nThe EpicStore Team`,
        html: getEmailWrapper(`
            <div class="content">
                <h2>Welcome Aboard! 🎊</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>Congratulations! Your email has been successfully verified and your account is now active.</p>
                
                <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 20px; border-radius: 8px; margin: 25px 0;">
                    <h3 style="color: #667eea; margin-top: 0;">🚀 Get Started:</h3>
                    <ul style="color: #555; line-height: 1.8;">
                        <li>Browse our extensive product catalog</li>
                        <li>Add items to your wishlist</li>
                        <li>Track your orders in real-time</li>
                        <li>Enjoy exclusive member benefits</li>
                    </ul>
                </div>
                
                <center>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="button">
                        Start Shopping Now
                    </a>
                </center>
                
                <p style="margin-top: 30px; color: #666;">
                    Need help? Our support team is always here to assist you.
                </p>
            </div>
        `)
    }),

    /**
     * Password Reset Template
     */
    passwordResetEmail: (name, code) => ({
        subject: 'Reset Your Password - EpicStore',
        text: `Hi ${name},\n\nWe received a request to reset your password.\n\nYour password reset code is: ${code}\n\nThis code will expire in 90 seconds for security reasons.\n\nIf you didn't request this, please ignore this email and your password will remain unchanged.\n\nBest regards,\nThe EpicStore Team`,
        html: getEmailWrapper(`
            <div class="content">
                <h2>🔐 Password Reset Request</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>We received a request to reset the password for your EpicStore account.</p>
                <p>Use the code below to reset your password:</p>
                
                <div class="code-box">
                    <div style="color: #666; font-size: 14px; margin-bottom: 10px;">Your Reset Code</div>
                    <div class="code">${code}</div>
                    <div style="color: #e74c3c; font-size: 12px; margin-top: 10px; font-weight: 600;">
                        ⏱️ Expires in 90 seconds
                    </div>
                </div>
                
                <div class="warning">
                    <strong>⚠️ Security Alert:</strong> For your protection, this code expires in 90 seconds. If you didn't request a password reset, please ignore this email or contact support immediately.
                </div>
                
                <div class="info-box">
                    <strong>💡 Tips for a strong password:</strong><br>
                    • Use at least 12 characters<br>
                    • Include uppercase and lowercase letters<br>
                    • Add numbers and special characters<br>
                    • Avoid common words or patterns
                </div>
            </div>
        `)
    }),

    /**
     * Password Changed Confirmation Template
     */
    passwordChangedEmail: (name) => ({
        subject: 'Your Password Has Been Changed - EpicStore',
        text: `Hi ${name},\n\nThis is to confirm that your password has been successfully changed.\n\nIf you made this change, no further action is required.\n\nIf you did NOT make this change, please contact our support team immediately and secure your account.\n\nBest regards,\nThe EpicStore Team`,
        html: getEmailWrapper(`
            <div class="content">
                <h2>✅ Password Changed Successfully</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>This email confirms that your EpicStore account password has been successfully changed.</p>
                
                <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px; color: #155724;">
                    <strong>✓ Change Confirmed:</strong> Your password was updated on ${new Date().toLocaleString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #333; margin-top: 0;">🔒 If this was you:</h3>
                    <p style="color: #666; margin-bottom: 0;">Great! Your account is secure. No further action is needed.</p>
                </div>
                
                <div class="warning" style="background-color: #fff3cd; border-left-color: #ff9800;">
                    <strong>⚠️ Didn't make this change?</strong><br>
                    If you did not change your password, your account may be compromised. Please:
                    <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                        <li>Reset your password immediately</li>
                        <li>Contact our support team</li>
                        <li>Review your recent account activity</li>
                    </ul>
                </div>
                
                <center>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/support" class="button" style="background: #dc3545;">
                        Contact Support
                    </a>
                </center>
            </div>
        `)
    }),

    /**
     * Account Locked Template
     */
    accountLockedEmail: (name, lockDuration) => ({
        subject: 'Account Temporarily Locked - EpicStore',
        text: `Hi ${name},\n\nYour account has been temporarily locked due to multiple failed login attempts.\n\nYour account will be automatically unlocked in ${lockDuration} minutes.\n\nIf this wasn't you, please reset your password immediately.\n\nBest regards,\nThe EpicStore Team`,
        html: getEmailWrapper(`
            <div class="content">
                <h2>🔒 Account Temporarily Locked</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>Your EpicStore account has been temporarily locked due to multiple failed login attempts.</p>
                
                <div style="background-color: #fff3cd; border: 2px solid #ffc107; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 10px;">⏱️</div>
                    <div style="font-size: 18px; color: #856404; font-weight: 600;">
                        Account will unlock in <span style="color: #ff9800; font-size: 24px;">${lockDuration} minutes</span>
                    </div>
                </div>
                
                <div class="info-box">
                    <strong>ℹ️ What happened?</strong><br>
                    We detected multiple unsuccessful login attempts to your account. For your security, we've temporarily locked it.
                </div>
                
                <div class="warning">
                    <strong>⚠️ Didn't try to log in?</strong><br>
                    If you didn't attempt to access your account, someone may be trying to gain unauthorized access. We recommend:
                    <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                        <li>Reset your password immediately after unlock</li>
                        <li>Enable two-factor authentication</li>
                        <li>Contact our support team</li>
                    </ul>
                </div>
                
                <center>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password" class="button">
                        Reset Password
                    </a>
                </center>
            </div>
        `)
    })
};