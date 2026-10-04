import { isNative, postNative } from './native'

/**
 * Native speech goes through AVSpeechSynthesizer with a ducking audio
 * session, so music in AirPods dips under the cue and comes back. The web
 * path is for dev in a browser.
 */
export function speak(text) {
  if (!text) return
  if (isNative) {
    postNative('speak', { text })
    return
  }
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.02
    synth.speak(utterance)
  } catch {
    // No speech engine; silent is fine.
  }
}

export function shareFile({ filename, mime, content }) {
  if (isNative) {
    postNative('share', { filename, mime, content })
    return
  }
  const file = new File([content], filename, { type: mime })
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: filename }).catch(() => {})
    return
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
