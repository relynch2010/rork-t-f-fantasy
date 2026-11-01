import SwiftUI

// MARK: - Colors

enum PosStyle {
    static func color(_ athlete: Athlete?) -> Color {
        guard let athlete else { return Theme.faint }
        if athlete.flex { return Theme.flex }
        switch athlete.positions.first {
        case .SPR: return Theme.sprint
        case .DIS: return Theme.distance
        case .FLD: return Theme.field
        case .none: return Theme.flex
        }
    }

    static func color(_ slot: Slot) -> Color {
        switch slot {
        case .SPR: return Theme.sprint
        case .DIS: return Theme.distance
        case .FLD: return Theme.field
        case .FLEX: return Theme.flex
        case .BN1, .BN2: return Theme.bench
        case .IR: return Theme.injured
        }
    }
}

// MARK: - Badges

/// Yahoo-style rectangular headshot (slightly rounded corners, never a circle). Initials when there's no photo.
struct AthleteBadge: View {
    let athlete: Athlete?
    var size: CGFloat = 44

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: max(4, size * 0.14), style: .continuous) }

    var body: some View {
        let tint = PosStyle.color(athlete)
        Text(athlete?.initials ?? "")
            .font(.system(size: size * 0.36, weight: .heavy).width(.condensed))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                shape.fill(LinearGradient(colors: [Theme.raised, Theme.surface2], startPoint: .top, endPoint: .bottom))
            )
            .overlay {
                // Master-database headshot (versioned URL, so a new photo is a new cache entry).
                if let path = athlete?.photo, !path.isEmpty, let url = URL(string: APIClient.base + path) {
                    AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        } else {
                            Color.clear
                        }
                    }
                    .frame(width: size, height: size)
                    .clipShape(shape)
                    .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .bottom) {
                // Position color bar along the bottom edge, like Yahoo's headshot tiles.
                if athlete != nil {
                    Rectangle().fill(tint).frame(height: max(2, size * 0.06))
                        .clipShape(shape)
                        .allowsHitTesting(false)
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(athlete == nil ? Theme.line : .white.opacity(0.12), lineWidth: 1))
            .overlay {
                if athlete == nil {
                    Image(systemName: "person.fill")
                        .font(.system(size: size * 0.38))
                        .foregroundStyle(Theme.faint)
                }
            }
    }
}

/// Team avatar: the manager's uploaded photo when set, otherwise colored initials (Yahoo-style).
struct TeamLogo: View {
    let team: Team?
    var size: CGFloat = 40

    @Environment(AppStore.self) private var store

    var body: some View {
        let color = Color(hex: team?.color ?? "8D99AE")
        Text(team?.initials ?? "?")
            .font(.system(size: size * 0.36, weight: .black).width(.condensed))
            .foregroundStyle(.black.opacity(0.85))
            .frame(width: size, height: size)
            .background(Circle().fill(LinearGradient(colors: [color, color.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing)))
            .overlay {
                if let url = store.avatarURL(for: team) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        } else {
                            Color.clear
                        }
                    }
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .allowsHitTesting(false)
                }
            }
            .overlay(Circle().strokeBorder(.white.opacity(0.15), lineWidth: 1))
    }
}

/// Pulsing LIVE / FINAL / UPCOMING pill for meets and matchups.
struct LiveStatusPill: View {
    let status: String
    var compact: Bool = false
    @State private var pulse: Bool = false

    var body: some View {
        let isLive = status == "LIVE"
        let color: Color = isLive ? Theme.red : status == "FINAL" || status == "CANCELED" ? Theme.muted : status == "PENDING" ? Theme.flex : status == "SCHEDULED" ? Theme.sprint : Theme.gold
        HStack(spacing: 5) {
            if isLive {
                Circle()
                    .fill(Theme.red)
                    .frame(width: 7, height: 7)
                    .scaleEffect(pulse ? 1.35 : 0.8)
                    .opacity(pulse ? 0.55 : 1)
                    .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
            }
            Text(status)
                .font(.system(size: compact ? 10 : 11, weight: .heavy))
                .tracking(0.8)
        }
        .foregroundStyle(isLive ? .white : color)
        .padding(.horizontal, compact ? 7 : 9)
        .frame(height: compact ? 20 : 24)
        .background(isLive ? Theme.red.opacity(0.22) : color.opacity(0.14), in: .capsule)
        .overlay(Capsule().strokeBorder(color.opacity(0.6), lineWidth: 1))
        .onAppear { pulse = true }
    }
}

enum SlotPillState {
    case normal, editable, selected, target, disabled
}

/// Yahoo-style vertical slot capsule on the left of each roster row.
struct SlotPill: View {
    let slot: Slot
    var state: SlotPillState = .normal

    var body: some View {
        let tint = PosStyle.color(slot)
        VStack(spacing: 3) {
            if state == .editable || state == .selected {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(state == .selected ? .black : Theme.muted)
            }
            if state == .target {
                Text("HERE")
                    .font(.system(size: 11, weight: .heavy).width(.condensed))
                    .foregroundStyle(.black)
            } else {
                Text(slot.short)
                    .font(.system(size: 13, weight: .heavy).width(.condensed))
                    .foregroundStyle(state == .selected ? .black : tint)
            }
        }
        .frame(width: 48, height: 54)
        .background(
            Capsule().fill(state == .selected ? tint : state == .target ? Theme.green : .clear)
        )
        .overlay(Capsule().strokeBorder(state == .selected || state == .target ? .clear : Theme.line.opacity(2.2), lineWidth: 1))
        .opacity(state == .disabled ? 0.35 : 1)
    }
}

/// Center slot square in the matchup comparison.
struct SlotSquare: View {
    let slot: Slot

    var body: some View {
        Text(slot.short)
            .font(.system(size: 12, weight: .heavy).width(.condensed))
            .foregroundStyle(PosStyle.color(slot))
            .frame(width: 42, height: 30)
            .background(Theme.surface2, in: .rect(cornerRadius: 8))
    }
}

/// Q / O / IR tag shown next to a player's name everywhere.
extension PlayerStatus {
    /// Tag colour: Doubtful sits between Questionable (gold) and Out (red). Informational only.
    var tint: Color {
        switch self {
        case .Q: return Theme.gold
        case .D: return Theme.field
        default: return Theme.red
        }
    }
}

struct StatusTag: View {
    let status: PlayerStatus
    var size: CGFloat = 10

    var body: some View {
        if let tag = status.tag {
            Text(tag)
                .font(.system(size: size, weight: .black).width(.condensed))
                .foregroundStyle(status == .Q || status == .D ? .black : .white)
                .padding(.horizontal, 5)
                .frame(height: size + 6)
                .background(status.tint, in: .rect(cornerRadius: 4))
                .accessibilityLabel(status.label)
        }
    }
}

struct PosLabel: View {
    let athlete: Athlete?
    var suffix: String?

    var body: some View {
        HStack(spacing: 4) {
            if let athlete { StatusTag(status: athlete.playerStatus) }
            Text(athlete?.posLabel ?? "Empty")
                .foregroundStyle(PosStyle.color(athlete))
            if let suffix {
                Text("• \(suffix)").foregroundStyle(Theme.muted)
            }
        }
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(1)
    }
}

// MARK: - Chips

struct ChipButton: View {
    let title: String
    var systemImage: String?
    var isOn: Bool = false
    var badge: Int = 0
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            ChipLabel(title: title, systemImage: systemImage, isOn: isOn, badge: badge)
        }
        .buttonStyle(PressableStyle())
    }
}

struct ChipLabel: View {
    let title: String
    var systemImage: String?
    var isOn: Bool = false
    var badge: Int = 0
    var trailingChevron: Bool = false

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 13, weight: .semibold))
            }
            Text(title).font(.system(size: 15, weight: isOn ? .semibold : .regular))
            if trailingChevron {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
            }
            if badge > 0 {
                Text("\(badge)")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 6)
                    .frame(minWidth: 18, minHeight: 18)
                    .background(Theme.gold, in: .capsule)
            }
        }
        .foregroundStyle(isOn ? Theme.greenBright : .white)
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(isOn ? Theme.green.opacity(0.14) : .clear, in: .capsule)
        .overlay(Capsule().strokeBorder(isOn ? Theme.green : .white.opacity(0.22), lineWidth: 1))
        .contentShape(.capsule)
    }
}

/// Yahoo "< | Week 3 | >" pill.
struct WeekSwitcher: View {
    @Binding var week: Int
    let range: ClosedRange<Int>
    let label: String

    var body: some View {
        HStack(spacing: 0) {
            Button {
                Haptics.tap()
                week = max(range.lowerBound, week - 1)
            } label: {
                Image(systemName: "chevron.left").frame(width: 38, height: 38)
            }
            .disabled(week <= range.lowerBound)
            Rectangle().fill(.white.opacity(0.22)).frame(width: 1, height: 22)
            Text(label)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
                .padding(.horizontal, 12)
                .contentTransition(.numericText())
            Rectangle().fill(.white.opacity(0.22)).frame(width: 1, height: 22)
            Button {
                Haptics.tap()
                week = min(range.upperBound, week + 1)
            } label: {
                Image(systemName: "chevron.right").frame(width: 38, height: 38)
            }
            .disabled(week >= range.upperBound)
        }
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(.white)
        .overlay(Capsule().strokeBorder(.white.opacity(0.22), lineWidth: 1))
        .animation(.snappy, value: week)
    }
}

struct ChipRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { content }
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollClipDisabled()
    }
}

// MARK: - Player row pieces

/// Name + position block. Tapping opens the player card.
struct AthleteNameBlock: View {
    let athlete: Athlete?
    var suffix: String?
    var alignment: HorizontalAlignment = .leading
    var compact: Bool = false

    @Environment(AppStore.self) private var store

    var body: some View {
        Button {
            guard let athlete else { return }
            Haptics.tap()
            store.sheet = .player(athlete.id)
        } label: {
            VStack(alignment: alignment, spacing: 3) {
                HStack(spacing: 5) {
                    Text(athlete.map { compact ? $0.shortName : $0.name.uppercased() } ?? "EMPTY")
                        .font(compact ? .system(size: 15, weight: .heavy).width(.condensed) : Theme.playerName)
                        .foregroundStyle(athlete == nil ? Theme.faint : .white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if let id = athlete?.id, (store.league?.reviewFlags?[id] ?? 0) > 0 {
                        ReviewMark()
                    }
                }
                PosLabel(athlete: athlete, suffix: suffix)
            }
            .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(athlete == nil)
    }
}

/// "?" Needs Review: a possible result for this player is waiting for the commissioner. Never scored until confirmed.
struct ReviewMark: View {
    var body: some View {
        Text("?")
            .font(.system(size: 11, weight: .black))
            .foregroundStyle(.black)
            .frame(width: 16, height: 16)
            .background(Theme.gold, in: .circle)
            .accessibilityLabel("Needs review: a possible result is waiting for the commissioner")
    }
}

/// Projection confidence: green High, gold Medium, gray Low.
struct ConfidenceDot: View {
    let level: String
    var body: some View {
        Circle()
            .fill(level == "High" ? Theme.green : level == "Medium" ? Theme.gold : Theme.faint)
            .frame(width: 7, height: 7)
            .accessibilityLabel("\(level) confidence")
    }
}

/// Points value. Tapping opens the scoring breakdown.
struct PointsButton: View {
    let athleteId: String?
    let value: Double?
    var week: Int?
    var size: CGFloat = 20
    var alignment: Alignment = .trailing

    @Environment(AppStore.self) private var store

    var body: some View {
        Button {
            guard let athleteId else { return }
            Haptics.tap()
            store.sheet = .breakdown(athleteId, week)
        } label: {
            Text(value.map(Fmt.pts) ?? "–")
                .font(Theme.score(size))
                .foregroundStyle(value == nil ? Theme.faint : (value ?? 0) < 0 ? Theme.red : .white)
                .underline(value != nil, color: .white.opacity(0.25))
                .frame(minWidth: 54, minHeight: 44, alignment: alignment)
                .contentShape(.rect)
                .contentTransition(.numericText())
        }
        .buttonStyle(.plain)
        .disabled(athleteId == nil)
    }
}

struct ColumnHeader: View {
    let title: String
    var trailing: [String] = []

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 20, weight: .bold))
            Spacer()
            ForEach(trailing, id: \.self) { t in
                Text(t)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(minWidth: 54, alignment: .trailing)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 6)
    }
}

struct RowDivider: View {
    var inset: CGFloat = 16
    var body: some View {
        Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, inset)
    }
}

struct StatColumn: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(Theme.score(26))
                .foregroundStyle(.white)
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - League chrome

/// Yahoo-style header: back to leagues, league name switcher, notifications bell.
struct LeagueChrome: ViewModifier {
    @Environment(AppStore.self) private var store

    func body(content: Content) -> some View {
        content
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Haptics.tap()
                        store.closeLeague()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .accessibilityLabel("All leagues")
                }
                ToolbarItem(placement: .principal) {
                    Menu {
                        ForEach(store.leagues) { summary in
                            Button {
                                store.open(leagueId: summary.leagueId)
                            } label: {
                                if summary.leagueId == store.league?.id {
                                    Label(summary.name, systemImage: "checkmark")
                                } else {
                                    Text(summary.name)
                                }
                            }
                        }
                        Divider()
                        Button("All leagues", systemImage: "square.grid.2x2") { store.closeLeague() }
                    } label: {
                        HStack(spacing: 5) {
                            Text(store.league?.name ?? "League")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.sheet = .notifications
                    } label: {
                        Image(systemName: store.unreadCount > 0 ? "bell.badge.fill" : "bell")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(store.unreadCount > 0 ? Theme.gold : .white, .white)
                    }
                    .accessibilityLabel("Notifications")
                }
            }
    }
}

extension View {
    func leagueChrome() -> some View { modifier(LeagueChrome()) }
}

struct ToastView: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green)
            Text(message).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.raised, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.line))
        .shadow(color: .black.opacity(0.4), radius: 14, y: 6)
    }
}

// MARK: - Filters

enum PosFilter: String, CaseIterable, Identifiable {
    case all = "All", spr = "SPR", dis = "DIS", fld = "FLD", flex = "FLEX"
    var id: String { rawValue }

    func matches(_ a: Athlete) -> Bool {
        switch self {
        case .all: return true
        case .spr: return a.positions.contains(.SPR) && !a.flex
        case .dis: return a.positions.contains(.DIS) && !a.flex
        case .fld: return a.positions.contains(.FLD) && !a.flex
        case .flex: return a.flex
        }
    }
}

nonisolated enum TextKey {
    /// Mirrors the server's keyOf(): lowercase, no accents, alphanumerics only.
    static func of(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en_US"))
            .lowercased()
            .filter { $0.isLetter || $0.isNumber }
            .filter { $0.isASCII }
    }
}
