import SwiftUI
import AVFoundation

final class LaunchAudio: NSObject, AVAudioPlayerDelegate {
    static let shared = LaunchAudio()
    private var player: AVAudioPlayer?
    private var all: [URL] = []
    private var queue: [URL] = []
    private var lastPlayed: URL?
    private var failures = 0
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        all = (Bundle.main.urls(forResourcesWithExtension: "m4a", subdirectory: "Audio") ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        guard !all.isEmpty else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            return
        }
        queue = all
        playNext()
    }

    private func reshuffle() {
        var next = all.shuffled()
        if next.count > 1, next.first == lastPlayed {
            next.swapAt(0, next.count - 1)
        }
        queue = next
    }

    private func playNext() {
        if queue.isEmpty { reshuffle() }
        guard !queue.isEmpty else { return }
        let url = queue.removeFirst()
        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.volume = 1.0
            p.prepareToPlay()
            p.play()
            player = p
            lastPlayed = url
            failures = 0
        } catch {
            failures += 1
            if failures < all.count { playNext() }
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        playNext()
    }
}

@main
struct CFIApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 0.118, green: 0.071, blue: 0.031)
                    .ignoresSafeArea()

                CFIWebView()
                    .ignoresSafeArea()
            }
            .onAppear {
                LaunchAudio.shared.start()
            }
        }
    }
}
