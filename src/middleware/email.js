import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import puppeteer from 'puppeteer';

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

const formatMoney = (value) => new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

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

// Ticket e-mail sent after payment
export async function sendTicketEmail({to,eventName,tierName,quantity,qrPayloads,bookingId,}) {
  if (!qrPayloads?.length) {
    console.warn('[ticket email] no QR payloads; email skipped');
    return { success: false, error: 'No QR payloads' };
  }

  // Generate one QR image per ticket (base64 PNG data URL, inline in HTML)
  const qrImages = await Promise.all(
    qrPayloads.map(async (payload) => {
      const dataUrl = await QRCode.toDataURL(payload, { width: 300 });
      return dataUrl;
    })
  );

  const greeting = to ? String(to).split('@')[0].trim() : 'there';
  const ticketRows = qrImages.map((dataUrl, i) => `
    <tr>
      <td style="vertical-align:top;width:28%;padding:0 12px 12px 0">
        <img src="${dataUrl}" alt="Ticket ${i + 1} QR code" style="width:100%;display:block;border-radius:0" />
        <p style="font-size:10px;color:#94A3B8;margin:6px 0 0">Ticket ${i + 1}</p>
      </td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#222;">
      <h2 style="margin-top:0;color:#1E293B;">
        Your ${escapeHtml(eventName)} tickets
      </h2>
      <p style="color:#444;margin-bottom:18px;">
        Hi ${escapeHtml(greeting)},<br><br>
        <strong style="color:#1E293B;">Thank you for buying your tickets with TikoSorted.</strong>
        You are all set for ${escapeHtml(eventName)}.
      </p>

      <div style="background:#F4F4F6;border:2px solid var(--ink);border-radius:0;padding:16px 20px;margin:14px 0;">
        <p style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#94A3B8;margin:0 0 6px;">Booking</p>
        <p style="font-family:var(--font-mono);font-size:12px;color:#444;word-break:break-all;">${escapeHtml(bookingId)}</p>
        <p style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#94A3B8;margin:8px 0 0;">
          Tickets · ${quantity} × ${escapeHtml(tierName)}
        </p>
      </div>

      <p style="margin:16px 0;">
        Your ticket QR codes are below. You can print them or keep them on your phone
        and show them at the gate.
      </p>

      <table style="width:100%;border-collapse:collapse;">
        ${ticketRows}
      </table>

      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
      <p style="font-size:13px;color:#666;">Log in anytime to view your tickets:</p>
      <p style="font-size:13px;color:#666;font-family:var(--font-mono);word-break:break-all;">
        ${process.env.FRONTEND_URL}/ticket/${bookingId}
      </p>
      <p style="font-size:12px;color:#888;">
        Sent by ${escapeHtml(APP_NAME)} — show your QR at the gate.
      </p>
    </div>
  `;

  const subject = `Your ${escapeHtml(eventName)} tickets — ${APP_NAME}`;

  return sendEmail({
    to,
    subject,
    text: `Hello ${greeting},\n\nThank you for buying your tickets with ${APP_NAME} for ${eventName}.\n\nYour tickets: ${quantity} × ${tierName}\nBooking ID: ${bookingId}\n\nYour QR codes are attached to this email. You can also view them at:\n${process.env.FRONTEND_URL}/ticket/${bookingId}\n\nShow your QR at the gate.`,
    html,
  });
}


export async function generatePdfBuffer(html) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try{
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ 
      format: 'A4', 
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    return Buffer.from(pdfBuffer);

  }catch(err){
    console.error('[pdf] failed to generate PDF', err.message);
    throw err;
  }finally{
    await browser.close();
  }
}

export async function sendPdfEmail({ to, subject, text, html, pdfBuffer, filename }) {
  if (!pdfBuffer || !filename) {
    console.warn('[pdf email] no PDF buffer or filename; email skipped');
    return { success: false, error: 'No PDF buffer or filename' };
  }
  return sendEmail({
    to,
    subject,
    text : `Hello,\n\nPlease find the attached report PDF document.\n\n${text || ''}`,
    html,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export function buildReportHtml({ event, sold, perTier, costs, totalCosts, netRevenue }) {
  const tierRows = perTier.rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.type.toUpperCase())}</td>
      <td style="text-align:right">${row.tickets}</td>
    </tr>
  `).join('');

  const costRows = costs.rows.map((row) => `
    <tr>
      <td>${escapeHtml(COST_CLASS_NAMES[row.classification] || row.classification)}</td>
      <td style="text-align:right">${formatMoney(row.amount)}</td>
    </tr>
  `).join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #1e293b; }
          h1 { margin-bottom: 4px; }
          .muted { color: #64748b; }
          .summary { display: flex; gap: 16px; margin: 24px 0; }
          .card { flex: 1; border: 1px solid #cbd5e1; padding: 14px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; }
          th { text-align: left; background: #f1f5f9; }
        </style>
      </head>
      <body>
        <h1>Event Report</h1>
        <p><strong>${escapeHtml(event.name)}</strong></p>
        <p class="muted">${escapeHtml(event.location || '')}${event.event_date ? ` — ${new Date(event.event_date).toLocaleDateString()}` : ''}</p>

        <div class="summary">
          <div class="card"><strong>${sold.rows[0].tickets_sold}</strong><br>Tickets sold</div>
          <div class="card"><strong>${formatMoney(sold.rows[0].revenue)}</strong><br>Revenue</div>
          <div class="card"><strong>${formatMoney(totalCosts)}</strong><br>Total costs</div>
          <div class="card"><strong>${formatMoney(netRevenue)}</strong><br>Net revenue</div>
        </div>

        <h2>Ticket distribution</h2>
        <table>
          <thead><tr><th>Tier</th><th style="text-align:right">Tickets</th></tr></thead>
          <tbody>${tierRows || '<tr><td colspan="2">No paid tickets</td></tr>'}</tbody>
        </table>

        <h2>Budget breakdown</h2>
        <table>
          <thead><tr><th>Classification</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${costRows || '<tr><td colspan="2">No costs recorded</td></tr>'}</tbody>
        </table>
      </body>
    </html>
  `;
}

export async function sendPdfToUser(user, { subject, pdfHtml, filename, message = '' }) {
  if (!user?.email) {
    return { success: false, error: 'User has no email address' };
  }

  let pdfBuffer;
  try {
    pdfBuffer = await generatePdfBuffer(pdfHtml);
  } catch (err) {
    console.error('[pdf email] PDF generation failed:', err.message);
    return { success: false, error: `PDF generation failed: ${err.message}` };
  }

  const name = user.name || 'there';
  return sendPdfEmail({
    to: user.email,
    subject,
    text: message,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(message || 'Your PDF is attached.')}</p>`
    ),
    pdfBuffer,
    filename: filename || `document-${Date.now()}.pdf`,
  });
}
