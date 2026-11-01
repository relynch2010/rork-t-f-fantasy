import SwiftUI

@main
struct TFFantasyApp: App {
    @State private var store: AppStore = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(store)
                .task { await store.bootstrap() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.resume() }
        }
    }
}
