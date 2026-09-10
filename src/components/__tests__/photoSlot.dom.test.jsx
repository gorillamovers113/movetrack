// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

/* The mover's photo slot, rendered.
 *
 * This layer exists because of what it is testing. "Adding pictures of the
 * vaults will only allow one picture" was reported as the app refusing more
 * than one photo. It accepted them all; the cleanup effect was revoking each
 * preview's blob URL as the next one arrived, so every shot but the newest
 * went blank. Nothing about that is visible from a domain test, because
 * nothing about it is logic.
 */

// The real upload path talks to Firebase Storage and resizes through a canvas,
// neither of which exists here. What matters is that every file that goes in
// comes back out as a URL, in order.
const uploaded = []
vi.mock('../../lib/upload.js', () => ({
  captureMedia: async (file, path) => {
    uploaded.push(path)
    return { url: `https://storage.test/${file.name}` }
  },
  uploadFile: async (file, path) => {
    uploaded.push(path)
    return `https://storage.test/${file.name}`
  },
}))

vi.mock('../../store.jsx', () => ({
  useStore: () => ({ dispatch: async () => {}, currentUser: { uid: 'm1', name: 'Ali Mover', role: 'mover' }, state: {} }),
  fmtTime: () => '9:00 AM',
}))

const { default: LoadOutCard } = await import('../LoadOutCard.jsx')

const revoked = []
beforeEach(() => {
  uploaded.length = 0
  revoked.length = 0
  let n = 0
  URL.createObjectURL = () => `blob:${++n}`
  URL.revokeObjectURL = (u) => revoked.push(u)
})
afterEach(cleanup)

const jpg = (name) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
const mp4 = (name) => new File([new Uint8Array([1, 2, 3])], name, { type: 'video/mp4' })

const PACKED = {
  id: 'u1', number: '906', tenant: 'Maria Ochoa', stage: 'packed',
  stickerColor: 'Orange', crew: { packers: [], movers: [] }, media: [], vaults: [], steps: {},
}

// Open the "photo of the unit, fully packed" step, which is the same PhotoSlot
// the vault doors use.
async function openPhotoStep() {
  render(<LoadOutCard unit={PACKED} toast={() => {}} />)
  fireEvent.click(screen.getByText('Photo of the unit, fully packed'))
  return await screen.findByText(/fully packed and ready to go/i)
}

const cameraInput = () => document.querySelector('input[accept="image/*"]')

describe('adding more than one photo to a step', () => {
  it('keeps every preview on screen as more arrive', async () => {
    await openPhotoStep()
    const input = cameraInput()

    fireEvent.change(input, { target: { files: [jpg('one.jpg')] } })
    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(1))

    fireEvent.change(input, { target: { files: [jpg('two.jpg')] } })
    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(2))

    fireEvent.change(input, { target: { files: [jpg('three.jpg')] } })
    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(3))
  })

  // The bug itself, named. Revoking a blob URL blanks the <img> still using it.
  it('never revokes a preview that is still on screen', async () => {
    await openPhotoStep()
    const input = cameraInput()
    fireEvent.change(input, { target: { files: [jpg('one.jpg')] } })
    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(1))
    fireEvent.change(input, { target: { files: [jpg('two.jpg')] } })
    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(2))

    const onScreen = [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(onScreen.some((src) => revoked.includes(src))).toBe(false)
  })

  it('uploads every one of them, not just the last', async () => {
    await openPhotoStep()
    const input = cameraInput()
    fireEvent.change(input, { target: { files: [jpg('one.jpg')] } })
    await waitFor(() => expect(uploaded).toHaveLength(1))
    fireEvent.change(input, { target: { files: [jpg('two.jpg')] } })
    await waitFor(() => expect(uploaded).toHaveLength(2))
    expect(new Set(uploaded).size).toBe(2)
  })

  it('takes a whole batch at once, for the library picker', async () => {
    await openPhotoStep()
    fireEvent.change(cameraInput(), { target: { files: [jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')] } })
    await waitFor(() => expect(uploaded).toHaveLength(3))
    expect(document.querySelectorAll('img')).toHaveLength(3)
  })

  it('mixes photos and video in one step', async () => {
    await openPhotoStep()
    const input = cameraInput()
    fireEvent.change(input, { target: { files: [jpg('a.jpg')] } })
    await waitFor(() => expect(uploaded).toHaveLength(1))
    fireEvent.change(input, { target: { files: [mp4('b.mp4')] } })
    await waitFor(() => expect(uploaded).toHaveLength(2))
    expect(document.querySelectorAll('img')).toHaveLength(1)
    expect(document.querySelectorAll('video')).toHaveLength(1)
    expect(uploaded[1]).toMatch(/\.mp4$/)
  })

  it('says how many are saved, so nobody has to guess', async () => {
    await openPhotoStep()
    fireEvent.change(cameraInput(), { target: { files: [jpg('a.jpg'), jpg('b.jpg')] } })
    await waitFor(() => expect(screen.getByText(/2 saved/)).toBeTruthy())
  })

  it('start over clears the lot and releases their urls', async () => {
    await openPhotoStep()
    fireEvent.change(cameraInput(), { target: { files: [jpg('a.jpg'), jpg('b.jpg')] } })
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(2))

    const before = [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    fireEvent.click(screen.getByText('Start over'))
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(0))
    expect(before.every((src) => revoked.includes(src))).toBe(true)
  })
})

describe('the camera the phone actually opens', () => {
  it('offers one accept type per input, which is what makes Android use the camera', async () => {
    await openPhotoStep()
    const inputs = [...document.querySelectorAll('input[type=file]')]
    const camera = inputs.filter((i) => i.getAttribute('capture'))
    expect(camera.map((i) => i.accept)).toEqual(['image/*', 'video/*'])
    // The library option must NOT carry capture, or it opens the camera too.
    const library = inputs.find((i) => !i.getAttribute('capture'))
    expect(library.accept).toBe('image/*,video/*')
  })

  it('lets every input take a batch', async () => {
    await openPhotoStep()
    for (const i of document.querySelectorAll('input[type=file]')) expect(i.multiple).toBe(true)
  })
})
