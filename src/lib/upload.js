// Client-side image upload to Firebase Storage: resize down to a sane max
// dimension (same canvas-resize approach as the old filesToMedia/resizeImage
// in store.jsx, which keeps embedding photos as data URLs) so uploads stay
// small on-site over weak signal, then push the JPEG blob to Storage and
// hand back its public download URL.
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase.js'

const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = () => reject(new Error('Could not read the file.'))
  r.readAsDataURL(file)
})

async function resizeToBlob(file, max = 1600, quality = 0.85) {
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
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the image for upload.')), 'image/jpeg', quality)
  })
}

// uploadImage(file, path) -> downloadURL. `path` is the full Storage object
// path, e.g. `units/{unitId}/inventory/{ts}-{uid}.jpg`.
export async function uploadImage(file, path) {
  if (!file) throw new Error('uploadImage: no file provided.')
  if (!path) throw new Error('uploadImage: no destination path provided.')

  let blob
  try {
    blob = await resizeToBlob(file)
  } catch (err) {
    throw new Error(`Couldn't process "${file.name}" — ${err.message || 'unreadable image file'}.`)
  }

  try {
    const objRef = ref(storage, path)
    await uploadBytes(objRef, blob)
    return await getDownloadURL(objRef)
  } catch (err) {
    throw new Error(`Upload failed for "${file.name}" — ${err.message || 'check your connection and try again'}.`)
  }
}
