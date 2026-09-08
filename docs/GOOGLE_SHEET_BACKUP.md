# Google Sheet backup

Every completed checklist item is mirrored into a Google Sheet as it happens:
one row per item, carrying who did it, when, and the unit's state at that
moment.

Firestore remains the record of truth. The sheet is a second, independent copy
that opens in a browser, sorts, filters and prints without the app. If a row
ever fails to send (dead spot, phone asleep), nothing is lost: **Reports →
Google Sheet backup → "Back up everything now"** rebuilds the entire sheet from
Firestore.

## Setup, once, about two minutes

1. Create a Google Sheet. Name it something like "Trinity Manor - MoveTrack backup".
2. In that sheet: **Extensions → Apps Script**.
3. Delete whatever is in the editor and paste the script below. Save.
4. **Deploy → New deployment**. Choose type **Web app**.
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Deploy, approve the permission prompt, and copy the **Web app URL**
     (it looks like `https://script.google.com/macros/s/AKfy.../exec`).
5. In MoveTrack: **Reports → Google Sheet backup**, paste the URL, press **Save**.
6. Press **Back up everything now** once to seed the sheet and confirm it works.

"Who has access: Anyone" means anyone holding that URL can append rows to this
sheet. It cannot read the sheet, and it cannot touch anything else in the
Google account. Treat the URL like a password: if it ever leaks, redeploy in
Apps Script to get a new one and paste the new URL into MoveTrack.

## The script

```javascript
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // two packers can finish an item at the same instant
  try {
    var body = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // Write the header row once, the first time anything arrives.
    if (sheet.getLastRow() === 0 && body.columns) {
      sheet.appendRow(body.columns);
      sheet.getRange(1, 1, 1, body.columns.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var rows = body.rows || [];
    if (rows.length > 0) {
      // One setValues beats appendRow in a loop: a full rebuild is hundreds
      // of rows and appendRow would take minutes.
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
           .setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, added: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
```

## Columns

`When`, `Unit`, `Tenant`, `Floor`, `Item`, `Done by`, `Role`, `Stage`,
`Progress`, `Sticker colour`, `Sticker numbers`, `Pieces`, `Cartons`,
`Carton breakdown`, `Photos`, `Note`, `Unit ID`

`Photos` is a count, not the images. Photos live in Firebase Storage and are
viewable in the app; a spreadsheet is the wrong place for them.

## Rebuilding

"Back up everything now" **appends** a fresh full set of rows rather than
replacing what is there. To rebuild cleanly, delete the sheet's rows first
(keep or delete the header, either works), then press the button.

## Why this rather than a Cloud Function

A Firestore trigger writing through the Sheets API would be the tidier
architecture and would not depend on the phone having a connection at that
moment. It needs the Firebase project on the Blaze billing plan, which was not
something to change the night before the first pack day. This route needed no
billing change and no service account.

Worth revisiting after the move: with Blaze enabled, the same rows could be
written server-side from a Firestore trigger, and a missed row would become
impossible rather than merely recoverable.
