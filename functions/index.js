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

import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Coarse on purpose. "iPhone · Safari" is what somebody reading a log wants;
// the full UA string is a fingerprint and tells them nothing extra.
function describe(ua) {
  const s = String(ua || "");
  const device = /iPad/i.test(s) ? "iPad"
    : /iPhone/i.test(s) ? "iPhone"
      : /Android/i.test(s) ? "Android phone"
        : /Macintosh/i.test(s) ? "Mac"
          : /Windows/i.test(s) ? "Windows PC"
            : /Linux/i.test(s) ? "Linux" : "Unknown device";
  const browser = /EdgA?\//i.test(s) ? "Edge"
    : /CriOS|Chrome\//i.test(s) ? "Chrome"
      : /FxiOS|Firefox\//i.test(s) ? "Firefox"
        : /Safari\//i.test(s) ? "Safari" : "Unknown browser";
  const os = (s.match(/(?:iPhone )?OS (\d+[._]\d+)/) || [])[1]?.replace("_", ".")
    || (s.match(/Android (\d+(?:\.\d+)?)/) || [])[1]
    || null;
  return { device, browser, os };
}

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
    // Recorded here rather than in the browser because a reset happens signed
    // out: there is no authenticated client to write it, and the IP is only
    // visible on this side. Written even when no such account exists, because
    // somebody guessing at addresses is exactly what an admin wants to see.
    const logReset = async (outcome, uid) => {
      try {
        const fwd = String(req.rawRequest?.headers?.["x-forwarded-for"] || "");
        await getFirestore().collection("authEvents").add({
          type: "passwordReset", email, outcome, uid: uid || null,
          at: Date.now(),
          ip: fwd.split(",")[0].trim() || req.rawRequest?.ip || null,
          ...describe(req.rawRequest?.headers?.["user-agent"]),
        });
      } catch (err) {
        console.error("[sendPasswordReset] could not log", err?.message);
      }
    };
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
      if (err?.code === "auth/user-not-found") { await logReset("no-account"); return { ok: true }; }
      await logReset("failed");
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
      await logReset("send-failed");
      throw new HttpsError("internal", "Could not send the email. Tell Casey.");
    }
    await logReset("sent");
    return { ok: true };
  },
);

/* Session telemetry, written server side.
 *
 * Casey asked to see who is using the app, from what, and when. Everything
 * here could be written straight from the browser except the two things that
 * matter most: the caller's IP, which a client cannot know about itself, and
 * the caller's identity, which a client could simply lie about. Both come off
 * the verified request instead, so a session record is worth reading.
 *
 * Deliberately bounded to the app. It records what the app itself is doing:
 * who opened it, on what, and which screen they are on. It does not ask the
 * browser for location, does not touch anything outside MoveTrack, and stores
 * a coarse device description rather than the full user-agent string.
 *
 * This is monitoring of a work tool, which is ordinary and lawful, and it is
 * personal information under California's CPRA. The crew have to be told it
 * exists. Overt is fine; covert is what creates exposure.
 */
export const recordSession = onCall(
  { region: "us-central1", cors: true, maxInstances: 10 },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const db = getFirestore();
    const uid = req.auth.uid;

    // Whatever a proxy says is first in the chain, else the socket address.
    const fwd = String(req.rawRequest?.headers?.["x-forwarded-for"] || "");
    const ip = fwd.split(",")[0].trim() || req.rawRequest?.ip || null;

    const { device, browser, os } = describe(req.rawRequest?.headers?.["user-agent"]);
    const now = Date.now();
    const view = String(req.data?.view || "").slice(0, 40) || null;
    const build = String(req.data?.build || "").slice(0, 60) || null;
    const screen = String(req.data?.screen || "").slice(0, 20) || null;
    const id = String(req.data?.sessionId || "").slice(0, 60);
    if (!id) throw new HttpsError("invalid-argument", "No session id.");

    const ref = db.doc(`sessions/${uid}__${id}`);
    const snap = await ref.get();

    if (!snap.exists) {
      const user = await db.doc(`users/${uid}`).get();
      await ref.set({
        uid,
        userName: user.get("name") || null,
        role: user.get("role") || null,
        startedAt: now,
        lastSeenAt: now,
        ip, device, browser, os, screen, build,
        view,
        views: view ? [{ view, at: now }] : [],
        viewCount: view ? 1 : 0,
      });
      return { ok: true, created: true };
    }

    const patch = { lastSeenAt: now, ip };
    if (view && view !== snap.get("view")) {
      patch.view = view;
      patch.viewCount = FieldValue.increment(1);
      // A rolling tail rather than every hop. Fifty is enough to see what
      // somebody was doing and small enough that a long day cannot grow the
      // document without bound.
      const views = [...(snap.get("views") || []), { view, at: now }].slice(-50);
      patch.views = views;
    }
    await ref.update(patch);
    return { ok: true, created: false };
  },
);
