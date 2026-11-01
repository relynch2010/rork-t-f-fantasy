import SwiftUI

// MARK: - Transactions

enum TxFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case adds = "Adds/Drops"
    case waivers = "Waivers"
    case trades = "Trades"
    case commish = "Commish"
    case scoring = "Scoring"
    var id: String { rawValue }

    func matches(_ kind: String) -> Bool {
        switch self {
        case .all: return true
        case .adds: return kind == "add" || kind == "drop"
        case .waivers: return kind == "waiver"
        case .trades: return kind == "trade"
        case .commish: return kind == "commish" || kind == "join" || kind == "draft"
        case .scoring: return kind == "score"
        }
    }
}

enum TxScope: String, CaseIterable, Identifiable {
    case mine = "My Moves"
    case league = "League"
    var id: String { rawValue }
}

/// One row on the Transactions screen with a clear status.
struct TxRow: Identifiable, Hashable {
    let id: String
    let kind: String
    let teamId: String?
    let text: String
    let at: Double
    let status: String
}

struct TransactionsView: View {
    @Environment(AppStore.self) private var store
    @State private var filter: TxFilter = .all
    @State private var scope: TxScope = .mine

    /// My Moves: my completed moves plus my own resolved claims and trade offers (the server only sends me mine).
    private func rows(_ league: LeagueState) -> [TxRow] {
        var out: [TxRow] = league.transactions
            .filter { scope == .league || ($0.mine ?? ($0.teamId == league.me)) }
            .map { TxRow(id: $0.id, kind: $0.kind, teamId: $0.teamId, text: $0.text, at: $0.at, status: $0.status ?? "completed") }
        if scope == .mine {
            for c in league.claims where c.status == "lost" || c.status == "cancelled" {
                let name = store.athlete(c.addId)?.name ?? c.addId
                let why = c.reason.isEmpty ? "" : " · \(c.reason)"
                out.append(TxRow(id: "claim-\(c.id)", kind: "waiver", teamId: c.teamId, text: "Claim for \(name)\(why)", at: c.resolvedAt ?? c.createdAt, status: c.status == "lost" ? "failed" : "cancelled"))
            }
            for t in league.trades where (t.fromId == league.me || t.toId == league.me) && t.status != "accepted" && t.status != "vetoed" {
                let other = league.team(t.fromId == league.me ? t.toId : t.fromId)?.teamName ?? "another team"
                let status: String = t.status == "review" ? "pending" : t.status == "rejected" || t.status == "declined" ? "declined" : t.status
                out.append(TxRow(id: "trade-\(t.id)", kind: "trade", teamId: t.fromId, text: "Trade with \(other): \(t.give.count) for \(t.get.count)", at: t.resolvedAt ?? t.createdAt, status: status))
            }
        }
        return out.filter { filter.matches($0.kind) }.sorted { $0.at > $1.at }
    }

    var body: some View {
        ScrollView {
            if let league = store.league {
                let items = rows(league)
                VStack(alignment: .leading, spacing: 0) {
                    Picker("Scope", selection: $scope) {
                        ForEach(TxScope.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    ChipRow {
                        ForEach(TxFilter.allCases) { f in
                            ChipButton(title: f.rawValue, isOn: filter == f) { filter = f }
                        }
                    }
                    .padding(.vertical, 12)

                    let mine = league.pendingClaims
                    if scope == .mine, !mine.isEmpty, filter == .all || filter == .waivers {
                        Text("MY PENDING CLAIMS")
                            .font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 8)
                        ForEach(mine) { c in
                            HStack(spacing: 12) {
                                AthleteBadge(athlete: store.athlete(c.addId), size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Add \(store.athlete(c.addId)?.name ?? c.addId)").font(.system(size: 15, weight: .semibold))
                                    Text([c.dropId.map { "Drop \(store.athlete($0)?.name ?? $0)" }, league.settings.isFAAB ? "Bid $\(c.bid)" : nil, league.waivers[c.addId].map { "Processes \(Fmt.dateTime($0))" }].compactMap { $0 }.joined(separator: " • "))
                                        .font(.caption).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Button("Cancel") {
                                    Task { await store.perform(["type": "cancelClaim", "claimId": c.id], success: "Claim cancelled") }
                                }
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.red)
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 60)
                            .background(Theme.surface)
                            RowDivider(inset: 64)
                        }
                        Spacer().frame(height: 18)
                    }

                    if items.isEmpty {
                        EmptyStateView(icon: "arrow.left.arrow.right", title: "Nothing yet", message: scope == .mine ? "Your adds, drops, waiver claims and trades show up here." : "Completed adds, drops, accepted trades and commissioner changes show up here.")
                    }
                    ForEach(items) { tx in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: icon(tx.kind))
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(color(tx.kind))
                                .frame(width: 34, height: 34)
                                .background(color(tx.kind).opacity(0.14), in: .circle)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(tx.text).font(.system(size: 15)).fixedSize(horizontal: false, vertical: true)
                                HStack(spacing: 6) {
                                    if let t = league.team(tx.teamId) {
                                        TeamLogo(team: t, size: 16)
                                    }
                                    Text(Fmt.dateTime(tx.at)).font(.caption).foregroundStyle(Theme.faint)
                                    statusPill(tx.status)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(Theme.surface)
                        RowDivider(inset: 62)
                    }
                }
                .padding(.bottom, 30)
            }
        }
        .background(TrackBackground())
        .navigationTitle("Transactions")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func statusPill(_ status: String) -> some View {
        let tint: Color = switch status {
        case "completed": Theme.green
        case "pending": Theme.waiver
        case "failed", "vetoed", "declined": Theme.red
        default: Theme.muted
        }
        return Text(status.capitalized)
            .font(.system(size: 10, weight: .heavy))
            .lineLimit(1).fixedSize()
            .foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(tint.opacity(0.14), in: .capsule)
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "add": return "plus"
        case "drop": return "minus"
        case "waiver": return "hand.raised.fill"
        case "trade": return "arrow.left.arrow.right"
        case "score": return "chart.bar.fill"
        case "draft": return "list.number"
        case "join": return "person.badge.plus"
        default: return "wrench.and.screwdriver.fill"
        }
    }

    private func color(_ kind: String) -> Color {
        switch kind {
        case "add": return Theme.green
        case "drop": return Theme.red
        case "waiver": return Theme.gold
        case "trade": return Theme.sprint
        case "score": return Theme.distance
        default: return Theme.muted
        }
    }
}

// MARK: - Trades

struct TradesView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            if let league = store.league {
                let incoming = league.incomingTrades
                let sent = league.trades.filter { $0.status == "pending" && $0.fromId == league.me }
                let review = league.trades.filter { $0.status == "review" }
                let history = league.trades.filter { !["pending", "review"].contains($0.status) }.sorted { ($0.resolvedAt ?? 0) > ($1.resolvedAt ?? 0) }
                VStack(alignment: .leading, spacing: 20) {
                    PrimaryButton(title: "Propose Trade", systemImage: "arrow.left.arrow.right") {
                        store.sheet = .trade(toId: nil, get: [], counterOf: nil)
                    }
                    .disabled(league.phaseKind != .season || deadlinePassed(league))
                    .opacity(league.phaseKind != .season || deadlinePassed(league) ? 0.45 : 1)
                    Text(deadlineText(league)).font(.caption).foregroundStyle(Theme.muted)

                    section("Offers to you", incoming, league) { t in
                        HStack(spacing: 8) {
                            smallButton("Accept", Theme.green) { Task { await store.perform(["type": "respondTrade", "tradeId": t.id, "accept": true], success: "Trade accepted") } }
                            smallButton("Counter", Theme.sprint) { store.sheet = .trade(toId: t.fromId, get: [], counterOf: t.id) }
                            smallButton("Decline", Theme.red) { Task { await store.perform(["type": "respondTrade", "tradeId": t.id, "accept": false], success: "Trade declined") } }
                        }
                    }
                    section("Sent offers", sent, league) { t in
                        smallButton("Cancel Offer", Theme.red) { Task { await store.perform(["type": "cancelTrade", "tradeId": t.id], success: "Offer cancelled") } }
                    }
                    section("Under review", review, league) { t in
                        VStack(alignment: .leading, spacing: 8) {
                            if let until = t.reviewUntil {
                                Text("Processes \(Fmt.dateTime(until))\(league.settings.tradeReview == "league" ? " • \(t.vetoes.count)/\(league.settings.vetoVotes) vetoes" : "")")
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                            if league.reviewNeedsMe(t) || (league.isCommissioner && t.fromId != league.me && t.toId != league.me) {
                                HStack(spacing: 8) {
                                    smallButton(league.isCommissioner ? "Approve" : "Allow", Theme.green) {
                                        Task { await store.perform(["type": "reviewTrade", "tradeId": t.id, "approve": true, "override": league.isCommissioner], success: "Trade approved") }
                                    }
                                    smallButton("Veto", Theme.red) {
                                        Task { await store.perform(["type": "reviewTrade", "tradeId": t.id, "approve": false, "override": league.isCommissioner], success: "Veto recorded") }
                                    }
                                }
                            }
                        }
                    }
                    if !history.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("History").font(.system(size: 20, weight: .bold))
                            ForEach(history.prefix(20)) { t in
                                HStack {
                                    Text("\(league.team(t.fromId)?.teamName ?? "") ↔ \(league.team(t.toId)?.teamName ?? "")")
                                        .font(.subheadline).lineLimit(1)
                                    Spacer()
                                    Text(t.status.capitalized)
                                        .font(.caption.weight(.heavy))
                                        .foregroundStyle(t.status == "accepted" ? Theme.green : Theme.muted)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }
                    if incoming.isEmpty && sent.isEmpty && review.isEmpty && history.isEmpty {
                        EmptyStateView(icon: "arrow.left.arrow.right", title: "No trades yet", message: "Open any rostered athlete and tap Trade for, or propose one here.")
                    }
                }
                .padding(16)
            }
        }
        .background(TrackBackground())
        .navigationTitle("Trades")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func deadlinePassed(_ league: LeagueState) -> Bool {
        league.settings.tradeDeadlineWeek > 0 && league.week > league.settings.tradeDeadlineWeek
    }

    private func deadlineText(_ league: LeagueState) -> String {
        if league.phaseKind != .season { return "Trades open once the season starts." }
        if league.settings.tradeDeadlineWeek == 0 { return "No trade deadline." }
        return deadlinePassed(league) ? "The trade deadline has passed." : "Trade deadline: end of week \(league.settings.tradeDeadlineWeek)."
    }

    @ViewBuilder
    private func section<Actions: View>(_ title: String, _ trades: [Trade], _ league: LeagueState, @ViewBuilder actions: @escaping (Trade) -> Actions) -> some View {
        if !trades.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(.system(size: 20, weight: .bold))
                ForEach(trades) { t in
                    VStack(alignment: .leading, spacing: 10) {
                        TradeSummaryCard(league: league, fromId: t.fromId, toId: t.toId, give: t.give, get: t.get, message: t.message)
                        actions(t)
                    }
                }
            }
        }
    }

    private func smallButton(_ title: String, _ tint: Color, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity, minHeight: 40)
                .overlay(Capsule().strokeBorder(tint.opacity(0.7)))
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - Bracket

struct BracketView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            if let league = store.league {
                if let bracket = league.bracket {
                    VStack(alignment: .leading, spacing: 20) {
                        if let champ = league.team(bracket.championId) {
                            HStack(spacing: 12) {
                                Image(systemName: "trophy.fill").font(.largeTitle).foregroundStyle(Theme.gold)
                                VStack(alignment: .leading) {
                                    Text("CHAMPION").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                                    Text(champ.teamName).font(Theme.display(26))
                                }
                            }
                            .card()
                        }
                        if !bracket.seeded {
                            Text("Seeds lock after week \(league.settings.regularWeeks). Projected from current standings:")
                                .font(.subheadline).foregroundStyle(Theme.muted)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .center, spacing: 16) {
                                ForEach(bracket.rounds, id: \.week) { round in
                                    VStack(alignment: .leading, spacing: 12) {
                                        Text(round.name.uppercased()).font(.system(size: 12, weight: .heavy)).tracking(1).foregroundStyle(Theme.green)
                                        Text("Week \(round.week)").font(.caption).foregroundStyle(Theme.muted)
                                        ForEach(round.games) { g in
                                            gameCard(league, g, week: round.week)
                                        }
                                    }
                                    .frame(width: 220)
                                }
                            }
                        }
                        .scrollClipDisabled()
                    }
                    .padding(16)
                } else {
                    EmptyStateView(icon: "trophy", title: "No playoffs yet", message: league.settings.playoffTeams == 0 ? "This league has no playoffs. The best record wins." : "The \(league.settings.playoffTeams)-team bracket is created when the draft ends.")
                }
            }
        }
        .background(TrackBackground())
        .navigationTitle("Playoffs")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func gameCard(_ league: LeagueState, _ g: BracketGame, week: Int) -> some View {
        VStack(spacing: 0) {
            teamLine(league, g.top, seed: g.topSeed, winner: g.winnerId, week: week)
            Rectangle().fill(Theme.line).frame(height: 1)
            teamLine(league, g.bottom, seed: g.bottomSeed, winner: g.winnerId, week: week)
        }
        .background(Theme.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.line))
    }

    private func teamLine(_ league: LeagueState, _ id: String?, seed: Int?, winner: String?, week: Int) -> some View {
        let t = league.team(id)
        let won = id != nil && winner == id
        let lost = winner != nil && winner != id
        return HStack(spacing: 8) {
            Text(seed.map(String.init) ?? "").font(.caption.weight(.bold).monospacedDigit()).foregroundStyle(Theme.muted).frame(width: 16)
            TeamLogo(team: t, size: 22)
            Text(t?.teamName ?? (id == nil && seed != nil ? "BYE" : "TBD"))
                .font(.system(size: 14, weight: won ? .bold : .regular))
                .foregroundStyle(lost ? Theme.faint : id == league.me ? Theme.green : .white)
                .lineLimit(1)
            Spacer()
            if let id, league.schedule.contains(where: { $0.week == week && $0.involves(id) }) {
                Text(Fmt.pts(league.weekScore(id, week: week))).font(.system(size: 13, weight: .bold).monospacedDigit())
                    .foregroundStyle(lost ? Theme.faint : .white)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 42)
    }
}

// MARK: - Settings (read-only)

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var confirmSignOut: Bool = false
    @State private var confirmDelete: Bool = false
    @State private var handoffs: [HandoffNeed] = []
    @State private var showHandoffs: Bool = false

    var body: some View {
        List {
            Section("Account") {
                row("Name", store.user?.name ?? "")
                row("Email", store.user?.email ?? "")
                NavigationLink(value: LeagueRoute.notificationSettings) {
                    Label("Notification settings", systemImage: "bell.badge")
                }
                .listRowBackground(Theme.surface)
                Button { store.showHowItWorks = true } label: {
                    Label("How T&F Fantasy works", systemImage: "questionmark.circle")
                }
                .listRowBackground(Theme.surface)
                if store.league?.isCommissioner == true {
                    NavigationLink(value: LeagueRoute.guide) {
                        Label("Commissioner Guide", systemImage: "book.closed")
                    }
                    .listRowBackground(Theme.surface)
                }
            }
            PasswordSection()
            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .listRowBackground(Theme.surface)
                Button("Delete account", role: .destructive) { confirmDelete = true }
                    .font(.footnote)
                    .listRowBackground(Theme.surface)
            }
            if let league = store.league {
                let s = league.settings
                Section("League") {
                    row("Name", league.name)
                    row("Invite code", league.code)
                    row("Commissioner", league.team(league.commissionerId)?.ownerName ?? "")
                    row("Teams", "\(league.teams.count) of \(s.maxTeams)")
                    row("Season", league.seasonLabel ?? String(league.season))
                    NavigationLink(value: LeagueRoute.pastSeasons) {
                        Label("Past Seasons", systemImage: "archivebox")
                    }
                    .listRowBackground(Theme.surface)
                }
                Section("Draft") {
                    row("Type", "Live snake, \(league.draft.rounds) rounds")
                    row("Date", s.draftAt.map(Fmt.dateTime) ?? "Not set")
                    row("Order", s.draftOrderMode == "random" ? "Random" : "Set by commissioner")
                    row("Pick timer", pickLabel(s.pickSeconds))
                }
                Section("Roster") {
                    row("Starters", "SPR, DIS, FLD, FLEX")
                    row("Bench", "2")
                    row("IR", "1 (IR or Out players only)")
                    row("Lineup lock", s.lineupLock == "results" ? "When results come in" : "Commissioner locks")
                }
                Section("Season & Playoffs") {
                    row("Regular season", "\(s.regularWeeks) weeks")
                    row("Playoff teams", s.playoffTeams == 0 ? "None" : "\(s.playoffTeams)")
                    row("Consolation", s.consolation ? "On" : "Off")
                    row("Tiebreaker", s.tiebreaker == "h2h" ? "Head-to-head" : "Points for")
                }
                Section("Waivers") {
                    row("Type", s.isFAAB ? "Budget bidding ($\(s.faabBudget))" : "Rolling priority")
                    row("Processing", s.waiverScheduleLabel)
                    row("Dropped players", s.isWeeklyWaivers ? "On waivers until the next run" : "\(s.waiverDays) day\(s.waiverDays == 1 ? "" : "s") on waivers")
                    row("Weekly add limit", s.maxAddsPerWeek == 0 ? "No limit" : "\(s.maxAddsPerWeek)")
                }
                Section("Trades") {
                    row("Review", s.tradeReview == "none" ? "None" : s.tradeReview == "league" ? "League vote" : "Commissioner")
                    if s.tradeReview != "none" { row("Review period", "\(s.tradeReviewDays) day\(s.tradeReviewDays == 1 ? "" : "s")") }
                    if s.tradeReview == "league" { row("Veto votes", "\(s.vetoVotes)") }
                    row("Deadline", s.tradeDeadlineWeek == 0 ? "None" : "Week \(s.tradeDeadlineWeek)")
                }
                Section("Scoring") {
                    ForEach(ScoringRules.rows(league.global?.rules), id: \.0) { r in row(r.0, r.1) }
                }
                if league.isCommissioner {
                    Section {
                        NavigationLink(value: LeagueRoute.editSettings) {
                            Label("Edit Settings", systemImage: "slider.horizontal.3").foregroundStyle(Theme.green)
                        }
                        .listRowBackground(Theme.surface)
                    }
                }
                LeaveLeagueSection(league: league)
            }
        }
        .screenBackground()
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Sign out of Fantasy T&F?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { store.signOut() }
        } message: {
            Text("Your leagues stay on your account. Sign back in on any phone.")
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) {
                Task {
                    if let needs = await store.deleteAccount() {
                        handoffs = needs
                        showHandoffs = true
                    }
                }
            }
        } message: {
            Text("This removes your login and your league memberships list. Teams already in leagues stay for the rest of the season. If you run a league with other members, you'll pick who takes over first.")
        }
        .sheet(isPresented: $showHandoffs) { DeleteHandoffSheet(needs: handoffs) }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(Theme.muted).multilineTextAlignment(.trailing)
        }
        .font(.system(size: 15))
        .listRowBackground(Theme.surface)
    }

    private func pickLabel(_ s: Int) -> String { s >= 60 ? "\(s / 60) min\(s % 60 > 0 ? " \(s % 60)s" : "")" : "\(s) sec" }
    private func hourLabel(_ h: Int) -> String {
        var c = DateComponents()
        c.hour = h
        let d = Calendar.current.date(from: c) ?? .now
        return "Daily at \(d.formatted(date: .omitted, time: .shortened))"
    }
}

/// Scoring summary read from the Main League's current rules (falls back to defaults until the server answers).
enum ScoringRules {
    static func rows(_ r: GlobalScoringRules?) -> [(String, String)] {
        let n = { (v: Double) in Fmt.short(v) }
        let list = { (v: [Double]) in v.map { Fmt.short($0) }.joined(separator: "/") }
        guard let r else {
            return [("Scoring", "Loading from the Main League…")]
        }
        let pct = r.percentile.sorted { $0.pct < $1.pct }
        return [
            ("Event participation", "+\(n(r.participation))"),
            ("Overall place 1–\(r.overall.count)", "+\(list(r.overall))"),
            ("Relay place 1–\(r.relay.count)", "+\(list(r.relay))"),
            ("Personal best", "+\(n(r.pb))"),
            ("Season best", "+\(n(r.sb))"),
            ("PB that's also an SB", "PB only (never stacked)"),
            ("Heat or flight place 1–\(r.heat.count)", "+\(list(r.heat))"),
            ("Time/mark performance tier", "Main League tables"),
            ("Top \(pct.map { "\(Int(($0.pct * 100).rounded()))" }.joined(separator: "/"))% seeded", "+\(pct.map { Fmt.short($0.pts) }.joined(separator: "/"))"),
            ("Standards (season cap)", "Up to +\(n(r.standardCap))"),
            ("School record", "+\(n(r.schoolRecord))"),
            ("Baton fumble", Fmt.signed(r.fumble)),
            ("DQ / DNF", "\(Fmt.signed(r.dqdnf)) (keeps +\(n(r.participation)))"),
        ]
    }
}
