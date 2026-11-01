import SwiftUI

enum StatusFilter: String, CaseIterable, Identifiable {
    case all = "All Players"
    case available = "Available"
    case freeAgents = "Free Agents"
    case waivers = "Waivers"
    case mine = "My Team"
    var id: String { rawValue }
}

enum PlayerSort: String, CaseIterable, Identifiable {
    case projected = "Projected"
    case recent = "Recent (3 wk)"
    case seasonAvg = "Season Avg"
    case waiver = "Waiver Order"
    case season = "Season Pts"
    case lastWeek = "Last Wk"
    case rank = "Draft Rank"
    var id: String { rawValue }

    /// Sorts that come from the rankings/projection service.
    var usesRankings: Bool { self == .projected || self == .recent || self == .seasonAvg }
}

/// Yahoo "Players" tab: search, status + position filters, sortable points column.
struct PlayersView: View {
    @Environment(AppStore.self) private var store
    @State private var query: String = ""
    @State private var showSearch: Bool = false
    @State private var status: StatusFilter = .available
    @State private var pos: PosFilter = .all
    @State private var sort: PlayerSort = .projected
    @State private var event: String = ""
    @State private var ranks: WaiverRankingsBody?
    @State private var dropTarget: Athlete?
    @FocusState private var searchFocused: Bool

    var body: some View {
        Group {
            if let league = store.league {
                content(league)
            }
        }
        .background(TrackBackground())
        .leagueChrome()
        .task(id: store.league?.version) { ranks = await store.rankings(week: projWeek) }
        .confirmationDialog("Drop \(dropTarget?.name ?? "")?", isPresented: Binding(get: { dropTarget != nil }, set: { if !$0 { dropTarget = nil } }), titleVisibility: .visible) {
            Button("Drop", role: .destructive) {
                guard let a = dropTarget else { return }
                Task { await store.perform(["type": "drop", "athleteId": a.id], success: "Dropped \(a.name)") }
            }
        } message: {
            Text("They'll go on waivers for \(store.league?.settings.waiverDays ?? 0) days.")
        }
    }

    /// Last completed week (server), falling back to the previous week before any week is final.
    private var lastWeek: Int {
        guard let league = store.league else { return 1 }
        if let w = league.lastCompletedWeek, w > 0 { return w }
        return max(1, league.week - 1)
    }

    /// The upcoming scoring period: this week, or next week once this week's final is on display.
    private var projWeek: Int {
        guard let league = store.league else { return 1 }
        return league.nextWeekAt != nil ? league.week + 1 : league.week
    }

    private var rankMap: [String: RankRow] {
        Dictionary((ranks?.rows ?? []).map { ($0.athleteId, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private func recentAvg(_ r: RankRow?) -> Double {
        let played = (r?.recent ?? []).filter(\.played).map(\.points)
        return played.isEmpty ? 0 : played.reduce(0, +) / Double(played.count)
    }

    private var eventOptions: [String] {
        Array(Set((ranks?.rows ?? []).flatMap(\.events))).sorted()
    }

    private func filtered(_ league: LeagueState) -> [Athlete] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let rm = rankMap
        let list = league.athletes.filter { a in
            guard pos.matches(a) else { return false }
            if !event.isEmpty, !(rm[a.id]?.events.contains(event) ?? false) { return false }
            if !trimmed.isEmpty, !a.name.localizedStandardContains(trimmed) { return false }
            switch (status, league.availability(a.id)) {
            case (.all, _): return true
            case (.available, .owned): return false
            case (.available, _): return true
            case (.freeAgents, .freeAgent): return true
            case (.waivers, .waivers): return true
            case (.mine, .owned(let id)): return id == league.me
            default: return false
            }
        }
        switch sort {
        case .projected:
            return list.sorted { (rm[$0.id]?.projected ?? -1, -Double($0.rank)) > (rm[$1.id]?.projected ?? -1, -Double($1.rank)) }
        case .recent:
            return list.sorted { (recentAvg(rm[$0.id]), -Double($0.rank)) > (recentAvg(rm[$1.id]), -Double($1.rank)) }
        case .seasonAvg:
            return list.sorted { (rm[$0.id]?.seasonAvg ?? -1, -Double($0.rank)) > (rm[$1.id]?.seasonAvg ?? -1, -Double($1.rank)) }
        case .waiver:
            let order = league.waiverRankMap
            return list.sorted { (order[$0.id] ?? Int.max, $0.rank) < (order[$1.id] ?? Int.max, $1.rank) }
        case .season:
            return list.sorted { league.seasonPoints($0.id) != league.seasonPoints($1.id) ? league.seasonPoints($0.id) > league.seasonPoints($1.id) : $0.rank < $1.rank }
        case .lastWeek:
            return list.sorted { league.points($0.id, week: lastWeek) != league.points($1.id, week: lastWeek) ? league.points($0.id, week: lastWeek) > league.points($1.id, week: lastWeek) : $0.rank < $1.rank }
        case .rank:
            return list.sorted { $0.rank < $1.rank }
        }
    }

    private func content(_ league: LeagueState) -> some View {
        let list = filtered(league)
        return ScrollView {
            LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    if list.isEmpty {
                        EmptyStateView(icon: "magnifyingglass", title: "No athletes", message: "Try a different filter or search.")
                    }
                    ForEach(list) { a in
                        row(league, a)
                        RowDivider(inset: 72)
                    }
                } header: {
                    VStack(spacing: 10) {
                        filterBar
                        legend
                        if showSearch {
                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                                TextField("Search athletes", text: $query)
                                    .focused($searchFocused)
                                    .autocorrectionDisabled()
                                if !query.isEmpty {
                                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.faint) }
                                }
                            }
                            .padding(.horizontal, 14)
                            .frame(height: 42)
                            .background(Theme.surface2, in: .capsule)
                            .padding(.horizontal, 16)
                        }
                        columns
                    }
                    .padding(.top, 8)
                    .background(Theme.bg)
                }
            }
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    private var filterBar: some View {
        ChipRow {
            Button {
                Haptics.tap()
                withAnimation(.snappy) { showSearch.toggle() }
                searchFocused = showSearch
                if !showSearch { query = "" }
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(showSearch ? Theme.greenBright : .white)
                    .frame(width: 38, height: 38)
                    .overlay(Circle().strokeBorder(showSearch ? Theme.green : .white.opacity(0.22)))
            }
            .accessibilityLabel("Search")
            Menu {
                Picker("Status", selection: $status) {
                    ForEach(StatusFilter.allCases) { Text($0.rawValue).tag($0) }
                }
            } label: {
                ChipLabel(title: status.rawValue, systemImage: "line.3.horizontal.decrease", isOn: status != .all, trailingChevron: true)
            }
            if !eventOptions.isEmpty {
                Menu {
                    Picker("Event", selection: $event) {
                        Text("All events").tag("")
                        ForEach(eventOptions, id: \.self) { Text($0).tag($0) }
                    }
                } label: {
                    ChipLabel(title: event.isEmpty ? "Event" : event, systemImage: "figure.run", isOn: !event.isEmpty, trailingChevron: true)
                }
            }
            ForEach(PosFilter.allCases) { option in
                ChipButton(title: option.rawValue, isOn: pos == option) { pos = option }
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            Label { Text("Waivers · claim") } icon: { Image(systemName: "plus.circle").foregroundStyle(Theme.waiver) }
            Label { Text("Free agent · add now") } icon: { Image(systemName: "plus.circle").foregroundStyle(Theme.freeAgent) }
            Spacer(minLength: 0)
            if sort.usesRankings {
                Text("Wk \(projWeek)").foregroundStyle(Theme.faint)
            }
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(Theme.muted)
        .lineLimit(1)
        .padding(.horizontal, 16)
    }

    private var columns: some View {
        HStack {
            Text("Player")
            NavigationLink(value: LeagueRoute.rankings) {
                Label("Rankings", systemImage: "list.number").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.green)
            }
            .padding(.leading, 8)
            Spacer()
            if sort == .waiver {
                Text("Wk \(lastWeek) pts").foregroundStyle(Theme.faint).padding(.trailing, 6)
            }
            if sort.usesRankings, ranks == nil {
                ProgressView().controlSize(.mini).padding(.trailing, 6)
            }
            Menu {
                Picker("Sort", selection: $sort) {
                    ForEach(PlayerSort.allCases) { Text($0.rawValue).tag($0) }
                }
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                    Text(sort.rawValue).underline()
                }
                .foregroundStyle(.white)
            }
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func row(_ league: LeagueState, _ a: Athlete) -> some View {
        let availability = league.availability(a.id)
        let value: Double? = {
            switch sort {
            case .lastWeek: return league.points[a.id]?["\(lastWeek)"]
            case .waiver: return league.lastWeekPoints?[a.id] ?? 0
            default: return league.seasonPoints(a.id)
            }
        }()
        let r = rankMap[a.id]
        return HStack(spacing: 10) {
            actionButton(league, a, availability)
            AthleteBadge(athlete: a, size: 40)
            AthleteNameBlock(athlete: a, suffix: statusText(league, availability), compact: true)
            if sort.usesRankings {
                rankingCell(r)
            } else {
                PointsButton(athleteId: a.id, value: sort == .rank ? league.seasonPoints(a.id) : value, week: sort == .lastWeek || sort == .waiver ? lastWeek : nil, size: 18)
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 16)
        .padding(.vertical, 6)
        .background(Theme.surface)
    }

    /// Projected (PROJ) vs actual numbers are always labeled separately.
    @ViewBuilder
    private func rankingCell(_ r: RankRow?) -> some View {
        VStack(alignment: .trailing, spacing: 3) {
            switch sort {
            case .projected:
                HStack(spacing: 4) {
                    ProjTag()
                    if let r, r.projected == 0, let short = ProjStateStyle.short(r.state) {
                        // An explicit state instead of a bare 0.00.
                        Text(short).font(.system(size: 12, weight: .heavy)).foregroundStyle(r.state == "insufficient" ? Theme.gold : Theme.faint)
                    } else {
                        Text(r.map { Fmt.pts($0.projected) } ?? "–").font(Theme.score(18)).foregroundStyle(Theme.muted)
                    }
                }
                .fixedSize()
                HStack(spacing: 4) {
                    if let c = r?.confidence { ConfidenceDot(level: c) }
                    if let r, r.state == "noMeet", let o = r.outlookPerMeet {
                        Text("~\(Fmt.short(o)) per meet").foregroundStyle(Theme.faint)
                    } else {
                        Text(r?.lastWeek.map { "Last \(Fmt.pts($0))" } ?? "No pts yet").foregroundStyle(Theme.faint)
                    }
                }
                .font(.system(size: 10, weight: .semibold))
            case .recent:
                Text(Fmt.pts(recentAvg(r))).font(Theme.score(18))
                trendLine(r)
            default:
                Text(r?.seasonAvg.map { Fmt.pts($0) } ?? "–").font(Theme.score(18))
                Text("\(r?.weeksPlayed ?? 0) wk played").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.faint)
            }
        }
        .frame(minWidth: 84, alignment: .trailing)
    }

    @ViewBuilder
    private func trendLine(_ r: RankRow?) -> some View {
        if let t = r?.trend {
            Label("\(t >= 0 ? "+" : "")\(Fmt.pts(t))", systemImage: t >= 0 ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(t >= 0 ? Theme.green : Theme.red)
                .labelStyle(.titleAndIcon)
        } else {
            Text("—").font(.system(size: 10)).foregroundStyle(Theme.faint)
        }
    }

    private func statusText(_ league: LeagueState, _ availability: Availability) -> String {
        switch availability {
        case .owned(let id): return id == league.me ? "My Team" : (league.team(id)?.teamName ?? "Owned")
        case .waivers(let until): return "W \(Fmt.monthDay(until))"
        case .freeAgent: return "FA"
        }
    }

    @ViewBuilder
    private func actionButton(_ league: LeagueState, _ a: Athlete, _ availability: Availability) -> some View {
        if league.isInSeason {
            switch availability {
            case .freeAgent, .waivers:
                let claimed = league.pendingClaims.contains { $0.addId == a.id }
                let isWaiver: Bool = { if case .waivers = availability { return true }; return false }()
                let tint: Color = isWaiver ? Theme.waiver : Theme.freeAgent
                Button {
                    store.requestAdd(a.id)
                } label: {
                    Image(systemName: claimed ? "clock.fill" : "plus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(tint)
                        .frame(width: 30, height: 30)
                        .overlay(Circle().strokeBorder(tint, lineWidth: 1.5))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(claimed ? "Claim pending" : isWaiver ? "Claim \(a.name) off waivers" : "Add free agent \(a.name)")
            case .owned(let id) where id == league.me:
                Button {
                    Haptics.tap()
                    dropTarget = a
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.red)
                        .frame(width: 30, height: 30)
                        .overlay(Circle().strokeBorder(Theme.red, lineWidth: 1.5))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Drop \(a.name)")
            case .owned(let id):
                Button {
                    Haptics.tap()
                    store.sheet = .trade(toId: id, get: [a.id], counterOf: nil)
                } label: {
                    Image(systemName: "arrow.left.arrow.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.sprint)
                        .frame(width: 30, height: 30)
                        .overlay(Circle().strokeBorder(Theme.sprint.opacity(0.8), lineWidth: 1.5))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Trade for \(a.name)")
            }
        } else if league.phaseKind != .complete, league.owner(of: a.id) == nil {
            let queued = league.myTeam?.queue.contains(a.id) ?? false
            Button {
                Haptics.tap()
                var q = league.myTeam?.queue ?? []
                if queued { q.removeAll { $0 == a.id } } else { q.append(a.id) }
                Task { await store.perform(["type": "setQueue", "ids": q], success: queued ? nil : "Added to draft queue") }
            } label: {
                Image(systemName: queued ? "star.fill" : "star")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(queued ? Theme.gold : Theme.muted)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(queued ? "Remove from queue" : "Add to queue")
        } else {
            Color.clear.frame(width: 44, height: 44)
        }
    }
}
