import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const smtpTransport =
  env.SMTP_HOST != null
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 1025,
        secure: false,
        ...(env.SMTP_USERNAME
          ? {
              auth: {
                user: env.SMTP_USERNAME,
                pass: env.SMTP_PASSWORD ?? "",
              },
            }
          : {}),
      })
    : null;

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}) {
  const from =
    env.SMTP_FROM ?? env.EMAIL_FROM ?? "BuildBoard <noreply@localhost>";

  // Prefer SMTP (Mailpit locally) when configured.
  if (smtpTransport) {
    try {
      await smtpTransport.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      return;
    } catch (error) {
      console.error("[email] SMTP send failed", error);
      console.info("[email] fallback content", { from, ...options });
      return;
    }
  }

  if (!resend) {
    console.warn("[email] No SMTP_HOST or RESEND_API_KEY — logging email instead");
    console.info({ from, ...options });
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM ?? from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    if (error) {
      console.error("[email] Resend rejected send", error);
      console.info("[email] fallback content", { from, ...options });
    }
  } catch (error) {
    console.error("[email] Resend failed to send", error);
    console.info("[email] fallback content", { from, ...options });
  }
}

export function verificationEmailHtml(fullName: string, verifyUrl: string) {
  return `
    <p>Hi ${fullName},</p>
    <p>Welcome to BuildBoard. Please verify your email:</p>
    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    <p>This link expires in 24 hours.</p>
  `;
}

export function resetPasswordEmailHtml(fullName: string, resetUrl: string) {
  return `
    <p>Hi ${fullName},</p>
    <p>Reset your BuildBoard password using this link:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
  `;
}
