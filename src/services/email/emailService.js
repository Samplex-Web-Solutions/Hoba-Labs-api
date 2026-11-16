import nodemailer from 'nodemailer';

const port = Number(process.env.SMTP_PORT) || 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: port,
  secure: port === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendLicenseEmail(toEmail, firstName, licenseKey, expiryDate) {
  const formattedDate = new Date(expiryDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const mailOptions = {
    from: '"Hoba Labs EA" <no-reply@hobalabs.com>',
    to: toEmail,
    subject: '🔑 Your Hoba Labs Cloud EA Activation Key',
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #0b0f19; color: #ffffff; padding: 24px; border-radius: 8px;">
        <h2 style="color: #f97316;">Welcome to Hoba Labs Cloud EA!</h2>
        <p>Hello ${firstName || 'Trader'},</p>
        <p>Your subscription is active. You can now activate your mobile cloud EA access without keeping a laptop on.</p>
        
        <div style="background-color: #1e293b; padding: 16px; border-radius: 6px; text-align: center; margin: 20px 0;">
          <span style="font-size: 12px; color: #94a3b8; display: block; margin-bottom: 4px;">YOUR ACTIVATION KEY</span>
          <strong style="font-size: 22px; color: #38bdf8; letter-spacing: 2px;">${licenseKey}</strong>
        </div>

        <p><strong>Expiration Date:</strong> ${formattedDate}</p>
        <p>Open your Hoba Labs Mobile Dashboard or Telegram app, navigate to <strong>Broker Settings</strong>, enter this key along with your MT5 broker details, and enable cloud trading.</p>
        <hr style="border: 1px solid #334155; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">If you need assistance setting up, reply directly to this email or contact Hoba Labs Support.</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}