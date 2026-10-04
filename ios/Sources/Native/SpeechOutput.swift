import AVFoundation
import OSLog

/// Turn cues through the riding headphones.
///
/// `.duckOthers` dips whatever is playing under the cue and
/// `.notifyOthersOnDeactivation` is what brings it back up afterwards — skip
/// that flag and the music stays quiet for the rest of the ride.
/// `.interruptSpokenAudioAndMixWithOthers` pauses podcasts instead of talking
/// over them.
@MainActor
final class SpeechOutput: NSObject {
    private let synthesizer = AVSpeechSynthesizer()
    private let log = Logger(subsystem: "com.bike.hud", category: "speech")

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try session.setActive(true)
        } catch {
            log.error("audio session: \(error.localizedDescription, privacy: .public)")
        }

        // A newer cue supersedes the one still talking — the old one is about
        // a turn the rider has probably already reached.
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .word)
        }

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.preUtteranceDelay = 0.12
        utterance.postUtteranceDelay = 0.2
        synthesizer.speak(utterance)
    }

    /// Only once the queue has drained — releasing between two utterances
    /// makes the music surge back up mid-sentence.
    private func releaseSessionIfIdle() {
        guard !synthesizer.isSpeaking else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            log.error("audio session release: \(error.localizedDescription, privacy: .public)")
        }
    }
}

extension SpeechOutput: AVSpeechSynthesizerDelegate {
    // The synthesizer parameter isn't Sendable; this class already owns it, so
    // the main-actor hop reads its own property instead of capturing it.
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.releaseSessionIfIdle()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.releaseSessionIfIdle()
        }
    }
}
