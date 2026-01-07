import nodeMailer from 'nodemailer';

/**
 * Enhanced email sending function with HTML support
 * Compatible with your existing SMTP configuration
 */
export const sendEmail = async (options) => {
    try {
        // Create transporter using your existing env variables
        const transporter = nodeMailer.createTransport({
            service: process.env.SMTP_SERVICE,
            auth: {
                user: process.env.SMTP_MAIL,
                pass: process.env.SMTP_PASSWORD
            }
        });

        // Email options - maintaining your structure
        const mailOptions = {
            from: process.env.SMTP_MAIL,
            to: options.email,
            subject: options.subject,
        };

        // Add HTML or plain text
        if (options.html) {
            mailOptions.html = options.html;
            mailOptions.text = options.message; // Fallback for non-HTML clients
        } else {
            mailOptions.text = options.message;
        }

        // Send email
        await transporter.sendMail(mailOptions);

        return { success: true };
    } catch (error) {
        console.error('Email sending error:', error);
        throw new Error('Failed to send email');
    }
};