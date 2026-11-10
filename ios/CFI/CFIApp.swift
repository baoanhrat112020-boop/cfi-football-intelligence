import SwiftUI
import AVFoundation

final class LaunchAudio: NSObject, AVAudioPlayerDelegate {
    static let shared = LaunchAudio()
    private var player: AVAudioPlayer?
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        let urls = Bundle.main.urls(forResourcesWithExtension: "m4a", subdirectory: "Audio") ?? []
        guard let url = urls.randomElement() else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.volume = 1.0
            p.prepareToPlay()
            p.play()
            player = p
        } catch {
            player = nil
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
