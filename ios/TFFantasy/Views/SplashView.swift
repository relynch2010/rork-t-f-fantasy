import SwiftUI

/// Minimal launch splash: the app icon only while the app signs in and loads.
struct SplashView: View {
    @State private var appeared = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: "04140B"), Color(hex: "0B2A18")], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            logo
                .scaleEffect(appeared ? 1 : 0.92)
                .opacity(appeared ? 1 : 0)
        }
        .onAppear {
            withAnimation(.spring(response: 0.65, dampingFraction: 0.82)) {
                appeared = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("T&F Fantasy is loading")
    }

    private var logo: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(LinearGradient(colors: [Theme.greenBright, Theme.green, Color(hex: "0F7A3C")], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 112, height: 112)
                .shadow(color: Theme.green.opacity(0.4), radius: 24, y: 8)

            VStack(spacing: 7) {
                ForEach(0..<3, id: \.self) { i in
                    Capsule()
                        .fill(.black.opacity(0.16))
                        .frame(width: 84 - CGFloat(i) * 10, height: 3)
                }
            }
            .offset(y: 26)

            Image(systemName: "figure.run")
                .font(.system(size: 52, weight: .bold))
                .foregroundStyle(.black.opacity(0.85))
                .offset(y: -6)
        }
    }
}
