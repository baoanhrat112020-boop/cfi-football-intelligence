import SwiftUI

@main
struct CFIApp: App {
    var body: some Scene {
        WindowGroup {
            CFIWebView()
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }
}
