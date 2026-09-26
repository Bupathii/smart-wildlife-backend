const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendPasswordResetEmail(to, resetUrl) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(`[email] SMTP not configured. Password reset link for ${to}:\n${resetUrl}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"Wildlife Conservation" <no-reply@wildlife.test>',
    to,
    subject: 'Reset your password',
    html: `
      <p>You requested a password reset for your Wildlife Conservation account.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 15 minutes. If you did not request this, you can ignore this email.</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
