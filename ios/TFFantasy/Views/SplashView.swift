import SwiftUI

/// Launch splash: deep green gradient, soft glow, logo and name rising in, a thin green line drawing underneath.
/// Shown only while the app signs in and loads; it fades out the moment loading finishes.
struct SplashView: View {
    @State private var appeared: Bool = false
    @State private var lineDrawn: Bool = false
    @State private var glow: Bool = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: "04140B"), Color(hex: "0B2A18")], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            RadialGradient(colors: [Theme.green.opacity(glow ? 0.34 : 0.18), .clear], center: .center, startRadius: 10, endRadius: 260)
                .ignoresSafeArea()
                .offset(y: -40)
            VStack(spacing: 22) {
                logo
                    .scaleEffect(appeared ? 1 : 0.86)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 18)
                VStack(spacing: 10) {
                    Text("T&F FANTASY")
                        .font(.system(size: 30, weight: .black).width(.condensed))
                        .tracking(3)
                        .foregroundStyle(Color(hex: "E8F5EC"))
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 12)
                    Capsule()
                        .fill(LinearGradient(colors: [Theme.green.opacity(0.2), Theme.green, Theme.green.opacity(0.2)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: lineDrawn ? 150 : 0, height: 3)
                    Text("Track & Field, drafted.")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color(hex: "E8F5EC").opacity(0.55))
                        .opacity(lineDrawn ? 1 : 0)
                }
            }
            .offset(y: -30)
        }
        .onAppear {
            withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appeared = true }
            withAnimation(.easeOut(duration: 0.6).delay(0.35)) { lineDrawn = true }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { glow = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("T&F Fantasy is loading")
    }

    private var logo: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(LinearGradient(colors: [Theme.greenBright, Theme.green, Color(hex: "0F7A3C")], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 112, height: 112)
                .shadow(color: Theme.green.opacity(0.55), radius: 30, y: 8)
            // Track lanes
            VStack(spacing: 7) {
                ForEach(0..<3, id: \.self) { i in
                    Capsule().fill(.black.opacity(0.16)).frame(width: 84 - CGFloat(i) * 10, height: 3)
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
