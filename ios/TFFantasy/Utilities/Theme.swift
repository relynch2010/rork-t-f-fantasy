import SwiftUI

/// Yahoo Fantasy dark-mode palette with TrackDraft green in place of Yahoo purple.
enum Theme {
    static let bg = Color(hex: "101518")
    static let surface = Color(hex: "1B2226")
    static let surface2 = Color(hex: "242D32")
    static let raised = Color(hex: "2C363C")
    static let line = Color.white.opacity(0.09)
    static let green = Color(hex: "20C463")
    static let greenBright = Color(hex: "3DDC7E")
    static let greenDeep = Color(hex: "0E3A22")
    static let gold = Color(hex: "F2C443")
    static let red = Color(hex: "FF5A5F")
    /// Yahoo-style availability: yellow + = waivers (claim), green + = free agent (instant add).
    static let waiver = Color(hex: "FFD60A")
    static let freeAgent = Color(hex: "20C463")
    static let redRow = Color(hex: "3A0B0E")
    static let muted = Color(hex: "9AA5AD")
    static let faint = Color(hex: "5F6B73")
    static let boys = Color(hex: "63B3FF")
    static let girls = Color(hex: "FF7AB6")

    static let sprint = Color(hex: "63B3FF")
    static let distance = Color(hex: "4FD6B8")
    static let field = Color(hex: "FF9A52")
    static let flex = Color(hex: "E9D64A")
    static let bench = Color(hex: "9AA5AD")
    static let injured = Color(hex: "FF5A5F")

    static func display(_ size: CGFloat, _ weight: Font.Weight = .heavy) -> Font {
        .system(size: size, weight: weight).width(.condensed)
    }

    static func score(_ size: CGFloat) -> Font {
        .system(size: size, weight: .heavy).width(.condensed).monospacedDigit()
    }

    /// Yahoo-style uppercase condensed player name font.
    static let playerName: Font = .system(size: 17, weight: .heavy).width(.condensed)
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        guard cleaned.count == 6 else {
            self.init(white: 0.7)
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

/// Solid Yahoo-dark canvas with a barely-there green glow at the top.
struct TrackBackground: View {
    var body: some View {
        ZStack {
            Theme.bg
            LinearGradient(colors: [Theme.green.opacity(0.07), .clear], startPoint: .top, endPoint: .center)
        }
        .ignoresSafeArea()
    }
}

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View {
        modifier(CardModifier(padding: padding))
    }

    func screenBackground() -> some View {
        background(TrackBackground())
            .scrollContentBackground(.hidden)
    }
}

struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct PrimaryButton: View {
    let title: String
    var systemImage: String?
    var tint: Color = Theme.green
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView().tint(.black)
                } else if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
            }
            .font(.headline)
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(tint, in: .capsule)
        }
        .buttonStyle(PressableStyle())
        .disabled(isLoading)
    }
}

struct SecondaryButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label {
                Text(title)
            } icon: {
                if let systemImage { Image(systemName: systemImage) }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(Theme.surface2, in: .capsule)
            .overlay(Capsule().strokeBorder(Theme.line))
        }
        .buttonStyle(PressableStyle())
    }
}

struct SectionHeader: View {
    let title: String
    var trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
        }
    }
}

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Theme.green)
            Text(title).font(Theme.display(22))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
    }
}

nonisolated enum Fmt {
    static func pts(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(2)))
    }

    static func ordinal(_ n: Int) -> String {
        let v = n % 100
        let suffix = (11...13).contains(v) ? "th" : ["th", "st", "nd", "rd"][min(n % 10, 4) < 4 ? n % 10 : 0]
        return "\(n)\(suffix)"
    }

    static func short(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    static func signed(_ value: Double) -> String {
        (value >= 0 ? "+" : "−") + abs(value).formatted(.number.precision(.fractionLength(0...2)))
    }

    static func ago(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.relative(presentation: .named))
    }

    static func monthDay(_ ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        return "\(Calendar.current.component(.month, from: date))/\(Calendar.current.component(.day, from: date))"
    }

    /// "5:42 PM"
    static func time(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .shortened)
    }

    static func dateTime(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
    }

    /// "2026-09-20" → "Sep 20"
    static func isoDay(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return iso }
        var comps = DateComponents()
        comps.year = parts[0]
        comps.month = parts[1]
        comps.day = parts[2]
        guard let date = Calendar.current.date(from: comps) else { return iso }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    static func clock(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
