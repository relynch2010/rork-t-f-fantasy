import ActivityKit
import SwiftUI
import WidgetKit

private enum LA {
    static let bg = Color(red: 0.02, green: 0.03, blue: 0.024)
    static let green = Color(red: 0.125, green: 0.77, blue: 0.39)
    static let red = Color(red: 1.0, green: 0.36, blue: 0.33)
    static let muted = Color.white.opacity(0.55)
    static let faint = Color.white.opacity(0.10)

    static func color(_ hex: String) -> Color {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        guard cleaned.count == 6 else { return .gray }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    static func pts(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }

    static func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first }.map { String($0).uppercased() }
        return letters.isEmpty ? "TD" : letters.joined()
    }

    static func score(_ size: CGFloat) -> Font {
        .system(size: size, weight: .black).width(.compressed).monospacedDigit()
    }

    /// Projected-total color for one side: green when that side is projected to win, red when projected to lose.
    static func projColor(mine: Double?, theirs: Double?) -> Color {
        guard let mine, let theirs else { return muted }
        if abs(mine - theirs) < 0.05 { return muted }
        return mine > theirs ? green : red
    }

    static func isFinal(_ s: MatchupAttributes.ContentState) -> Bool { s.status == "FINAL" }
}

/// Team avatar: initials on the team color, like Yahoo's team logos.
private struct TeamAvatar: View {
    let name: String
    let hex: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(LA.color(hex).gradient)
            Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
            Text(LA.initials(name))
                .font(.system(size: size * 0.36, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.6)
        }
        .frame(width: size, height: size)
    }
}

/// LIVE (green, with a dot) or FINAL (grey) badge.
private struct StatusBadge: View {
    let state: MatchupAttributes.ContentState

    var body: some View {
        let final = LA.isFinal(state)
        HStack(spacing: 4) {
            if !final { Circle().fill(.black).frame(width: 5, height: 5) }
            Text(final ? "FINAL" : "LIVE")
                .font(.system(size: 10, weight: .heavy))
                .tracking(0.8)
        }
        .foregroundStyle(final ? LA.muted : .black)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(final ? LA.faint : LA.green, in: .capsule)
    }
}

/// Big score with its projected total underneath.
private struct ScoreColumn: View {
    let score: Double
    let winning: Bool
    let proj: Double?
    let otherProj: Double?
    let final: Bool
    let alignment: HorizontalAlignment
    var size: CGFloat = 40

    var body: some View {
        VStack(alignment: alignment, spacing: 0) {
            Text(LA.pts(score))
                .font(LA.score(size))
                .foregroundStyle(winning ? .white : LA.muted)
                .contentTransition(.numericText(value: score))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if !final, let proj {
                Text("Proj \(LA.pts(proj))")
                    .font(.system(size: 11, weight: .bold).monospacedDigit())
                    .foregroundStyle(LA.projColor(mine: proj, theirs: otherProj))
                    .contentTransition(.numericText(value: proj))
            }
        }
    }
}

struct MatchupLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MatchupAttributes.self) { context in
            LockScreenMatchup(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(LA.bg)
                .activitySystemActionForegroundColor(LA.green)
        } dynamicIsland: { context in
            let a = context.attributes
            let s = context.state
            let final = LA.isFinal(s)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        TeamAvatar(name: a.myTeam, hex: a.myColor, size: 34)
                        ScoreColumn(score: s.myScore, winning: s.myScore >= s.oppScore, proj: s.myProj, otherProj: s.oppProj, final: final, alignment: .leading, size: 30)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 8) {
                        ScoreColumn(score: s.oppScore, winning: s.oppScore > s.myScore, proj: s.oppProj, otherProj: s.myProj, final: final, alignment: .trailing, size: 30)
                        TeamAvatar(name: a.oppTeam, hex: a.oppColor, size: 34)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 3) {
                        StatusBadge(state: s)
                        Text("WK \(a.week)")
                            .font(.system(size: 10, weight: .heavy))
                            .foregroundStyle(LA.muted)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        HStack {
                            Text(a.myTeam).lineLimit(1)
                            Spacer(minLength: 8)
                            Text("vs").foregroundStyle(LA.muted)
                            Spacer(minLength: 8)
                            Text(a.oppTeam).lineLimit(1)
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.85))
                        HStack {
                            Label(s.myLeader, systemImage: "star.fill")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.75))
                                .lineLimit(1)
                            Spacer()
                            Text(s.detail)
                                .font(.caption2.weight(.heavy))
                                .foregroundStyle(s.myScore >= s.oppScore ? LA.green : LA.red)
                        }
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Circle().fill(LA.color(a.myColor)).frame(width: 8, height: 8)
                    Text(LA.pts(s.myScore))
                        .font(LA.score(16))
                        .foregroundStyle(s.myScore >= s.oppScore ? LA.green : .white)
                        .contentTransition(.numericText(value: s.myScore))
                }
            } compactTrailing: {
                HStack(spacing: 4) {
                    Text(LA.pts(s.oppScore))
                        .font(LA.score(16))
                        .foregroundStyle(s.oppScore > s.myScore ? LA.red : .white)
                        .contentTransition(.numericText(value: s.oppScore))
                    Circle().fill(LA.color(a.oppColor)).frame(width: 8, height: 8)
                }
            } minimal: {
                HStack(spacing: 2) {
                    Circle().fill(LA.color(a.myColor)).frame(width: 5, height: 5)
                    Text(LA.pts(s.myScore))
                        .font(LA.score(13))
                        .foregroundStyle(s.myScore >= s.oppScore ? LA.green : .white)
                        .contentTransition(.numericText(value: s.myScore))
                }
            }
            .keylineTint(LA.green)
        }
    }
}

/// Yahoo-style matchup card: avatars on the sides, big scores in the middle, projections under each score,
/// team names with "vs", and a footer with league, week and LIVE/FINAL.
private struct LockScreenMatchup: View {
    let attributes: MatchupAttributes
    let state: MatchupAttributes.ContentState

    var body: some View {
        let final = LA.isFinal(state)
        let total = state.myScore + state.oppScore
        let share = total <= 0 ? 0.5 : state.myScore / total
        VStack(spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                TeamAvatar(name: attributes.myTeam, hex: attributes.myColor)
                ScoreColumn(score: state.myScore, winning: state.myScore >= state.oppScore, proj: state.myProj, otherProj: state.oppProj, final: final, alignment: .leading)
                Spacer(minLength: 4)
                VStack(spacing: 4) {
                    if final {
                        Text(state.detail.uppercased())
                            .font(.system(size: 12, weight: .black))
                            .foregroundStyle(state.myScore > state.oppScore ? LA.green : state.myScore < state.oppScore ? LA.red : LA.muted)
                    } else {
                        Text(state.detail)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(state.myScore >= state.oppScore ? LA.green : LA.red)
                            .lineLimit(1)
                    }
                    Text("vs")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(LA.muted)
                }
                Spacer(minLength: 4)
                ScoreColumn(score: state.oppScore, winning: state.oppScore > state.myScore, proj: state.oppProj, otherProj: state.myProj, final: final, alignment: .trailing)
                TeamAvatar(name: attributes.oppTeam, hex: attributes.oppColor)
            }

            HStack {
                Text(attributes.myTeam)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(attributes.oppTeam)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.85))
            .lineLimit(1)

            GeometryReader { geo in
                HStack(spacing: 2) {
                    Capsule().fill(LA.color(attributes.myColor)).frame(width: max(4, (geo.size.width - 2) * share))
                    Capsule().fill(LA.color(attributes.oppColor))
                }
            }
            .frame(height: 4)

            HStack(spacing: 8) {
                Text("\((state.leagueName ?? attributes.leagueName).uppercased()) · WEEK \(attributes.week)")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(LA.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Label(state.myLeader, systemImage: "star.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(1)
                StatusBadge(state: state)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}
