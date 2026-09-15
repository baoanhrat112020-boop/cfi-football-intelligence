import SwiftUI

@main
struct CFIApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 0.024, green: 0.082, blue: 0.133)
                    .ignoresSafeArea()

                CFIWebView()
                    .ignoresSafeArea()
            }
        }
    }
}
