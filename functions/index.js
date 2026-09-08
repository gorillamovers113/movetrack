/* Branded password-reset email for MoveTrack.
 *
 * Firebase Auth will happily send a reset email on its own, but it sends from
 * noreply@movetrack-gorilla.firebaseapp.com, which has no relationship to
 * gorillamovers.com. Casey's own test landed in spam, and crew who cannot get
 * back into the app mid-move is a real problem. Firebase's template editor
 * also cannot carry an image, so the Gorilla logo is impossible there.
 *
 * So we generate the reset link ourselves with the Admin SDK and send it
 * through SendGrid, from an address on a domain that is actually
 * authenticated. Same link Firebase would have sent, better envelope.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import sgMail from "@sendgrid/mail";

const SENDGRID_KEY = defineSecret("SENDGRID_KEY");
// The verified sender on gorillamovers.com. Configurable so it can be
// re-pointed without a code change.
const FROM_EMAIL = defineString("RESET_FROM_EMAIL", { default: "noreply@gorillamovers.com" });

initializeApp();

const APP_URL = "https://mygorillaproject.com";
const LOGO_URL = `${APP_URL}/gm-logo.png`;

function template(link) {
  // Table layout and inline styles: email clients are not browsers, and
  // flexbox/grid do not survive Outlook or Gmail's sanitiser.
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td align="center" style="background:#16181d;padding:26px 24px;">
          <img src="${LOGO_URL}" alt="Gorilla Movers" width="168" style="display:block;border:0;max-width:168px;height:auto;">
        </td></tr>
        <tr><td style="padding:30px 30px 8px;font-family:Helvetica,Arial,sans-serif;">
          <h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:#16181d;">Reset your MoveTrack password</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#454b54;">
            Someone asked to reset the password for this MoveTrack account. Tap the button to choose a new one.
            The link works once and expires in an hour.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:4px 30px 26px;">
          <a href="${link}" style="display:inline-block;background:#f5891f;color:#16181d;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 30px;border-radius:10px;">
            Set a new password
          </a>
        </td></tr>
        <tr><td style="padding:0 30px 26px;font-family:Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
            If the button does not work, paste this into your browser:
          </p>
          <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;color:#2563eb;">${link}</p>
        </td></tr>
        <tr><td style="padding:18px 30px 26px;border-top:1px solid #eef0f2;font-family:Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#6b7280;">
            Didn't ask for this? Ignore this email and your password stays as it is.
          </p>
          <p style="margin:10px 0 0;font-size:12.5px;color:#9aa1ab;">
            Gorilla Movers &middot; MoveTrack &middot; Trinity Manor
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const plain = (link) => [
  "Reset your MoveTrack password",
  "",
  "Someone asked to reset the password for this MoveTrack account.",
  "Open this link to choose a new one. It works once and expires in an hour.",
  "",
  link,
  "",
  "Didn't ask for this? Ignore this email and your password stays as it is.",
  "",
  "Gorilla Movers - MoveTrack",
].join("\n");

export const sendPasswordReset = onCall(
  { secrets: [SENDGRID_KEY], region: "us-central1", cors: true, maxInstances: 5 },
  async (req) => {
    const email = String(req.data?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "Enter the email on your account.");
    }

    let link = null;
    try {
      link = await getAuth().generatePasswordResetLink(email, { url: APP_URL });
    } catch (err) {
      // No account for that address. Return success anyway: telling a caller
      // which emails exist turns this endpoint into an account-enumeration
      // oracle. The person who owns the account still gets nothing, which is
      // the correct outcome.
      if (err?.code === "auth/user-not-found") return { ok: true };
      throw new HttpsError("internal", "Could not start the reset. Try again.");
    }

    try {
      sgMail.setApiKey(SENDGRID_KEY.value());
      await sgMail.send({
        to: email,
        from: { email: FROM_EMAIL.value(), name: "Gorilla Movers" },
        subject: "Reset your MoveTrack password",
        text: plain(link),
        html: template(link),
        // This is a password reset. It must never be suppressed by an
        // unsubscribe from a marketing list, and it carries no tracking
        // pixel or rewritten links: rewritten links are a large part of why
        // transactional mail gets scored as spam.
        trackingSettings: {
          clickTracking: { enable: false, enableText: false },
          openTracking: { enable: false },
        },
        mailSettings: { bypassListManagement: { enable: true } },
      });
    } catch (err) {
      console.error("[sendPasswordReset] SendGrid refused", err?.response?.body || err?.message);
      throw new HttpsError("internal", "Could not send the email. Tell Casey.");
    }
    return { ok: true };
  },
);
