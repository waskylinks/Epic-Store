import nodemailer from 'nodemailer';
import { emailTemplates } from './emailTemplates.js'; // your existing templates

/**
 * Enhanced Email Sending Function with Debugging
 */
export const sendEmail = async (options) => {
    try {
        // Debug: check environment variables
        if (!process.env.SMTP_MAIL || !process.env.SMTP_PASSWORD) {
            console.error('❌ SMTP credentials are missing!');
            throw new Error('SMTP_MAIL or SMTP_PASSWORD not set in .env');
        }

        console.log('🔹 Preparing to send email to:', options.email);

        // Create transporter
        const transporter = nodemailer.createTransport({
            service: process.env.SMTP_SERVICE || 'gmail',
            auth: {
                user: process.env.SMTP_MAIL,
                pass: process.env.SMTP_PASSWORD
            }
        });

        // Debug: verify transporter
        await transporter.verify();
        console.log('✅ SMTP transporter verified successfully');

        // Prepare email options
        const mailOptions = {
            from: process.env.SMTP_MAIL,
            to: options.email,
            subject: options.subject,
            text: options.text || '',
            html: options.html || undefined
        };

        // Debug: show payload (without secrets)
        console.log('📧 Email payload:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject,
            htmlLength: mailOptions.html?.length || 0,
            textLength: mailOptions.text?.length || 0
        });

        // Send the email
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully:', info.response);

        return { success: true, info };
    } catch (error) {
        console.error('❌ Email sending error:', error.message);
        throw new Error(`Failed to send email: ${error.message}`);
    }
};

/**
 * Optional: Test Function
 * Run this standalone to check if Gmail SMTP works
 */
export const testEmail = async () => {
    try {
        await sendEmail({
            email: process.env.SMTP_MAIL,
            subject: 'Test Email from EpicStore',
            text: 'This is a test email to verify SMTP configuration.',
            html: `<p>This is a test email from <strong>EpicStore</strong>.</p>`
        });
        console.log('✅ Test email sent successfully');
    } catch (err) {
        console.error('❌ Test email failed:', err.message);
    }
};
