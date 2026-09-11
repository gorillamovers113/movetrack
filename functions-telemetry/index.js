/* Session telemetry, in its own codebase.
 *
 * Separate from the email functions on purpose. Firebase analyses an entire
 * codebase on every deploy, so a function that declares a secret blocks the
 * deploy of every other function beside it: the access log could not ship
 * because a SendGrid key had no value. These two things have nothing to do
 * with each other and should not be able to hold each other up.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();

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
