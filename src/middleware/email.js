// middleware/email.js
// npm install nodemailer
import nodemailer from 'nodemailer';

const APP_NAME = process.env.APP_NAME || 'Event Manager';
let transporter = null;

const smtpHost = process.env.EMAIL_HOST || process.env.SMTP_HOST;
const smtpPort = process.env.EMAIL_PORT || process.env.SMTP_PORT;
const smtpUser = process.env.EMAIL_USER || process.env.SMTP_USER;
const smtpPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
const smtpSecure = process.env.EMAIL_SECURE || process.env.SMTP_SECURE;

function isConfigured() {
  return Boolean(smtpHost && smtpUser && smtpPass);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort) || 587,
      secure: smtpSecure === 'true',
      auth: { 
        user: smtpUser, 
        pass: smtpPass },
    });
  }
  return transporter;
}



// ---------- helpers ----------

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function layout(title, bodyHtml) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#222">
    <h2 style="margin-top:0">${escapeHtml(title)}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 12px">
    <p style="font-size:12px;color:#888">Sent by ${escapeHtml(APP_NAME)}</p>
  </div>`;
}


export async function sendEmail({ to, subject, text, html, attachments }) {
  // No SMTP configured: log in development, refuse in production
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[email] SMTP is not configured; email NOT sent to', to);
      return { success: false, error: 'Email service is not configured' };
    }
    console.log(`[email:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { success: true, messageId: 'dev-log-only' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.MAIL_FROM || smtpUser,
      to,
      subject,
      text,
      html,
      attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[email] Failed to send to', to, '-', err.message);
    return { success: false, error: err.message };
  }
}

// artist verification email
export function sendVerificationEmail(artist, token, { eventName, expiresInHours = 72 } = {}) {
  const link = `${process.env.FRONTEND_URL}/artist/verify/${encodeURIComponent(token)}`;
  const eventLine = eventName ? ` for ${eventName}` : '';

  return sendEmail({
    to: artist.email,
    subject: `Confirm your email${eventLine} - ${APP_NAME}`,
    text:
      `Hi ${artist.name},\n\n` +
      `You have been added${eventLine} on ${APP_NAME}. ` +
      `Open this link to confirm your email, add your preferences and register your entourage:\n${link}\n\n` +
      `The link expires in ${expiresInHours} hours and is personal. Do not share it.\n` +
      `If you were not expecting this, you can ignore this email.`,
    html: layout(
      'Confirm your email',
      `<p>Hi ${escapeHtml(artist.name)},</p>
       <p>You have been added${escapeHtml(eventLine)} on ${escapeHtml(APP_NAME)}.
          Confirm your email to add your preferences and register your entourage.</p>
       <p>
         <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;
            padding:12px 24px;border-radius:6px;text-decoration:none">Confirm email</a>
       </p>
       <p style="font-size:13px;color:#666">Or paste this link into your browser:<br>${link}</p>
       <p style="font-size:13px;color:#666">The link expires in ${expiresInHours} hours and is personal.
          Do not share it. If you were not expecting this email, you can ignore it.</p>`
    ),
  });
}

// entourage verification email
export function sendEntourageVerificationEmail(member, artist, token, { expiresInHours = 72 } = {}) {
  const link =
    `${process.env.FRONTEND_URL}/entourage/verify/${encodeURIComponent(token)}` +
    `?artistId=${encodeURIComponent(artist.id)}`;

  return sendEmail({
    to: member.email,
    subject: `${artist.name} added you to their entourage - ${APP_NAME}`,
    text:
      `Hi ${member.name},\n\n` +
      `${artist.name} added you to their entourage on ${APP_NAME}. ` +
      `Open this link to confirm your email:\n${link}\n\n` +
      `The link expires in ${expiresInHours} hours.\n` +
      `If you do not know ${artist.name}, you can ignore this email.`,
    html: layout(
      'Confirm your email',
      `<p>Hi ${escapeHtml(member.name)},</p>
       <p>${escapeHtml(artist.name)} added you to their entourage on ${escapeHtml(APP_NAME)}.
          Confirm your email to be part of the event crew.</p>
       <p>
         <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;
            padding:12px 24px;border-radius:6px;text-decoration:none">Confirm email</a>
       </p>
       <p style="font-size:13px;color:#666">Or paste this link into your browser:<br>${link}</p>
       <p style="font-size:13px;color:#666">The link expires in ${expiresInHours} hours.
          If you do not know ${escapeHtml(artist.name)}, you can ignore this email.</p>`
    ),
  });
}