import SwiftUI

struct ContentView: View {
    @Environment(AppStore.self) private var store

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )
    }

    var body: some View {
        Group {
            if store.user == nil {
                OnboardingView()
                    .transition(.opacity)
            } else if store.activeLeagueId == nil {
                LeaguesView()
                    .transition(.opacity)
            } else {
                LeagueRootView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: store.user?.id)
        .animation(.smooth, value: store.activeLeagueId)
        .overlay {
            if store.isBooting {
                SplashView().transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.45), value: store.isBooting)
        .preferredColorScheme(.dark)
        .tint(Theme.green)
        .overlay(alignment: .top) {
            if store.activeLeagueId == nil, let toast = store.toast {
                ToastView(message: toast)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .alert("Heads up", isPresented: errorBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.errorMessage ?? "")
        }
    }
}
