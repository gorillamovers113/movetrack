// Client-side image capture: resize down to a sane max dimension (same
// canvas-resize approach as the old filesToMedia/resizeImage in store.jsx,
// which keeps embedding photos as data URLs) so captures stay small on-site
// over weak signal, then try pushing the JPEG blob to Firebase Storage.
//
// Firebase Storage has no offline queue: uploadBytes() rejects outright when
// offline instead of hanging or queuing like a Firestore write does. Four
// of the app's required-photo steps (finish packing, overflow prep, overflow
// return, BigBox swap) used to call uploadImage() directly, which meant a
// crew member with no signal was hard-blocked from completing the single
// most common step in the app. captureMedia() below is the fix: it tries
// Storage first, and on any failure (offline or otherwise) falls back to
// the same resized data URL that filesToMedia() already uses. A data URL
// rides along embedded on the Firestore doc write, which DOES queue
// offline, so the action still completes.
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase.js'

// A weak-but-connected link (captive portal, elevator) can leave Firebase
// Storage retrying internally for minutes before it rejects. Race the upload
// against this budget so captureMedia falls back to the embedded data URL
// fast instead of leaving a required-photo step stuck on "Saving...".
const UPLOAD_TIMEOUT_MS = 8000

const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = () => reject(new Error('Could not read the file.'))
  r.readAsDataURL(file)
})

async function resizeToCanvas(file, max = 1400) {
  const dataUrl = await readAsDataURL(file)
  const img = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not decode the image.'))
    i.src = dataUrl
  })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

function canvasToBlob(canvas, quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the image for upload.'))), 'image/jpeg', quality)
  })
}

// uploadImage(file, path) -> downloadURL. `path` is the full Storage object
// path, e.g. `units/{unitId}/inventory/{ts}-{uid}.jpg`. Rejects if Storage
// can't be reached (offline included), so capture handlers should call
// captureMedia() below instead of this directly.
export async function uploadImage(file, path) {
  if (!file) throw new Error('uploadImage: no file provided.')
  if (!path) throw new Error('uploadImage: no destination path provided.')

  let canvas
  try {
    canvas = await resizeToCanvas(file)
  } catch (err) {
    throw new Error(`Couldn't process "${file.name}", ${err.message || 'unreadable image file'}.`)
  }

  try {
    const blob = await canvasToBlob(canvas)
    const objRef = ref(storage, path)
    await uploadBytes(objRef, blob)
    return await getDownloadURL(objRef)
  } catch (err) {
    throw new Error(`Upload failed for "${file.name}", ${err.message || 'check your connection and try again'}.`)
  }
}

// captureMedia(file, path) -> { url, storage: boolean }. Tries the Storage
// upload first so photos land off-device whenever there is a connection; on
// any failure (offline, a dropped connection mid-upload, a genuine Storage
// error) it falls back to a resized data URL from the same decoded image,
// so the caller always gets a usable `url` and a required photo never
// blocks the action. `storage` tells the caller which path was actually
// used, in case it wants to say so (not required, the `url` alone renders
// fine in an <img> either way).
export async function captureMedia(file, path) {
  if (!file) throw new Error('captureMedia: no file provided.')
  if (!path) throw new Error('captureMedia: no destination path provided.')

  let canvas
  try {
    canvas = await resizeToCanvas(file)
  } catch (err) {
    throw new Error(`Couldn't process "${file.name}", ${err.message || 'unreadable image file'}.`)
  }

  try {
    const blob = await canvasToBlob(canvas)
    const objRef = ref(storage, path)
    const url = await Promise.race([
      (async () => { await uploadBytes(objRef, blob); return getDownloadURL(objRef) })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Storage upload timed out.')), UPLOAD_TIMEOUT_MS)),
    ])
    return { url, storage: true }
  } catch {
    return { url: canvas.toDataURL('image/jpeg', 0.82), storage: false }
  }
}
