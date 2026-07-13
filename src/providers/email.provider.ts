import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}) {
  const from = env.EMAIL_FROM ?? env.SMTP_FROM ?? "onboarding@resend.dev";

  if (!resend) {
    console.warn("[email] RESEND_API_KEY missing — logging email instead");
    console.info({ from, ...options });
    return;
  }

  try {
    await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  } catch (error) {
    console.error("[email] failed to send", error);
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
