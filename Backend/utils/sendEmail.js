import nodemailer from 'nodemailer';

let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;

  if (!process.env.SMTP_MAIL || !process.env.SMTP_PASSWORD) {
    throw new Error('SMTP_MAIL or SMTP_PASSWORD not set in .env');
  }

  _transporter = nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: {
      user: process.env.SMTP_MAIL,
      pass: process.env.SMTP_PASSWORD,
    },
    pool: true,
    maxConnections: 3,
  });

  return _transporter;
};

export const sendEmail = async (options) => {
  try {
    console.log('🔹 Preparing to send email to:', options.email);

    const transporter = getTransporter();

    const mailOptions = {
      from:    process.env.SMTP_MAIL,
      to:      options.email,
      subject: options.subject,
      text:    options.text || '',
      html:    options.html || undefined,
    };

    console.log('📧 Email payload:', {
      from:       mailOptions.from,
      to:         mailOptions.to,
      subject:    mailOptions.subject,
      htmlLength: mailOptions.html?.length || 0,
      textLength: mailOptions.text?.length || 0,
    });

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.response);

    return { success: true, info };
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export const testEmail = async () => {
  try {
    await sendEmail({
      email:   process.env.SMTP_MAIL,
      subject: 'Test Email from EpicStore',
      text:    'This is a test email to verify SMTP configuration.',
      html:    `<p>This is a test email from <strong>EpicStore</strong>.</p>`,
    });
    console.log('✅ Test email sent successfully');
  } catch (err) {
    console.error('❌ Test email failed:', err.message);
  }
};