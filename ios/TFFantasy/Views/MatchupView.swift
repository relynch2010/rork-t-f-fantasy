import SwiftUI

/// Yahoo matchup screen: scoreboard, win probability, slot-by-slot comparison.
struct MatchupView: View {
    let teamId: String?
    let initialWeek: Int?

    @Environment(AppStore.self) private var store
    @State private var week: Int = 0
    @State private var showBench: Bool = false
    @State private var lines: [ScoreLine] = []
    @State private var proj: WeekProjections?
    @State private var traceTeam: String?

    var body: some View {
        Group {
            if let league = store.league {
                if league.phaseKind == .predraft || league.phaseKind == .drafting {
                    predraft(league)
                } else {
                    content(league)
                }
            }
        }
        .background(TrackBackground())
        .leagueChrome()
        .onAppear {
            if week == 0 { week = initialWeek ?? store.league?.displayWeek ?? 1 }
        }
    }

    private func content(_ league: LeagueState) -> some View {
        let shownWeek = week == 0 ? league.displayWeek : week
        let focus = teamId ?? league.me
        let matchup = league.matchup(for: focus, week: shownWeek)
        let me = league.team(focus)
        let opp = league.team(matchup?.opponent(of: focus))
        return ScrollView {
            VStack(spacing: 0) {
                if let meet = league.meet(forWeek: shownWeek) {
                    LiveMeetBar(meet: meet)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                }
                scoreboard(league, matchup: matchup, me: me, opp: opp, week: shownWeek)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                ChipRow {
                    WeekSwitcher(
                        week: Binding(get: { shownWeek }, set: { week = $0 }),
                        range: 1...max(1, league.totalWeeks),
                        label: league.weekLabel(shownWeek)
                    )
                    NavigationLink(value: LeagueRoute.scoreboard(shownWeek)) {
                        ChipLabel(title: "All Matchups", systemImage: "square.grid.2x2")
                    }
                    .buttonStyle(.plain)
                    if focus == league.me, shownWeek == league.displayWeek, matchup != nil {
                        LiveActivityChip(league: league)
                    }
                }
                .padding(.vertical, 14)

                if let me {
                    comparison(league, me: me, opp: opp, week: shownWeek)
                } else {
                    EmptyStateView(icon: "calendar", title: "No matchup", message: "There's no game for this week.")
                }
            }
            .padding(.bottom, 40)
        }
        .sheet(item: Binding(get: { traceTeam.map { IdentifiedString(value: $0) } }, set: { traceTeam = $0?.value })) { item in
            TeamTraceView(teamId: item.value, week: shownWeek)
                .environment(store)
                .preferredColorScheme(.dark)
        }
        .task(id: "\(league.version)|\(shownWeek)|\(focus)") {
            lines = await store.matchupLines(week: shownWeek, teamId: focus)
            proj = await store.projections(week: shownWeek)
        }
        .refreshable { await store.fetchLeague(force: true) }
    }

    /// "55m 3rd 6.81 · 1600m LIVE" — one short summary per event for a rostered athlete.
    private func eventSummary(_ athleteId: String?) -> String? {
        guard let athleteId else { return nil }
        let mine = lines.filter { $0.athleteId == athleteId }
        guard !mine.isEmpty else { return nil }
        var seen: [String] = []
        var out: [String] = []
        for l in mine where !seen.contains(l.sourceId) {
            seen.append(l.sourceId)
            let detail = (l.detail ?? "").split(separator: "·").prefix(2).map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
            out.append(detail.isEmpty ? l.event : "\(l.event) \(detail)")
        }
        return out.joined(separator: " · ")
    }

    // MARK: Scoreboard

    private func scoreboard(_ league: LeagueState, matchup: Matchup?, me: Team?, opp: Team?, week: Int) -> some View {
        let my = me.map { league.weekScore($0.id, week: week) } ?? 0
        let their = opp.map { league.weekScore($0.id, week: week) } ?? 0
        let isFinal = matchup?.final ?? false
        let mp: MatchupProjection? = proj?.week == week ? proj?.matchups.first(where: { $0.id == matchup?.id }) : nil

        let serverWin: Double? = mp.flatMap { m in me?.id == m.homeId ? m.winHome : m.winAway }
        let finalProb: Double = my > their ? 1 : my < their ? 0 : 0.5
        let prob: Double = isFinal ? finalProb : (serverWin.map { $0 / 100 } ?? 0.5)
        let weekProj: WeekProjections? = proj?.week == week ? proj : nil
        let myProj: TeamProjection? = me.flatMap { weekProj?.teams[$0.id] }
        let oppProj: TeamProjection? = opp.flatMap { weekProj?.teams[$0.id] }
        return VStack(spacing: 14) {
            if let round = matchup?.round {
                Text(round.uppercased())
                    .font(.system(size: 12, weight: .heavy))
                    .tracking(1.2)
                    .foregroundStyle(Theme.gold)
            }
            HStack(alignment: .top) {
                Text(me?.teamName.uppercased() ?? "")
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(opp?.teamName.uppercased() ?? (matchup == nil ? "" : "BYE WEEK"))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.muted)
            .lineLimit(1)

            HStack(spacing: 10) {
                TeamLogo(team: me, size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Fmt.pts(my))
                        .font(Theme.score(40))
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .foregroundStyle(isFinal && my < their ? Theme.muted : .white)
                        .contentTransition(.numericText())
                    if let me { Text(me.record).font(.caption).foregroundStyle(Theme.muted) }
                    if !isFinal, let p = myProj { projLine(p.total) }
                }
                Spacer(minLength: 4)
                if isFinal {
                    resultBadge(my: my, their: their)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(opp == nil ? "–" : Fmt.pts(their))
                        .font(Theme.score(40))
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .foregroundStyle(isFinal && their < my ? Theme.muted : .white)
                        .contentTransition(.numericText())
                    if let opp { Text(opp.record).font(.caption).foregroundStyle(Theme.muted) }
                    if !isFinal, let p = oppProj { projLine(p.total) }
                }
                TeamLogo(team: opp, size: 48)
            }

            if opp != nil {
                VStack(spacing: 6) {
                    GeometryReader { geo in
                        HStack(spacing: 3) {
                            Capsule().fill(Theme.green).frame(width: max(4, geo.size.width * prob - 1.5))
                            Capsule().fill(Theme.raised)
                        }
                    }
                    .frame(height: 6)
                    .animation(.smooth, value: prob)
                    HStack {
                        Text(isFinal ? "" : pct(serverWin))
                        Spacer()
                        Text(isFinal ? "FINAL" : serverWin == nil ? "Win probability unavailable" : league.meet(forWeek: week)?.isLive == true ? "LIVE • Win probability" : "Win probability")
                            .foregroundStyle(isFinal ? Theme.gold : league.meet(forWeek: week)?.isLive == true ? Theme.red : Theme.muted)
                        Spacer()
                        Text(isFinal ? "" : pct(serverWin.map { 100 - $0 }))
                    }
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.muted)
                    pointsLegend(isFinal: isFinal, pending: league.meet(forWeek: week)?.isPending == true)
                    if !isFinal, proj?.stale == true {
                        Label("Live source is down. Showing the last good projection.", systemImage: "wifi.exclamationmark")
                            .font(.caption2).foregroundStyle(Theme.gold)
                    }
                    if isFinal, week == league.week, let next = league.nextWeekAt {
                        Label("Final. \(league.weekLabel(week + 1)) matchup activates \(Fmt.dateTime(next)).", systemImage: "calendar.badge.clock")
                            .font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .card()
    }

    private func pct(_ v: Double?) -> String {
        guard let v else { return "–" }
        return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))%" : String(format: "%.1f%%", v)
    }

    /// Projected vs actual vs finalized, spelled out under every matchup.
    private func pointsLegend(isFinal: Bool, pending: Bool) -> some View {
        HStack(spacing: 6) {
            Text(isFinal ? "FINALIZED" : pending ? "ACTUAL · PENDING" : "ACTUAL")
                .font(.system(size: 9, weight: .black)).tracking(0.8)
                .foregroundStyle(isFinal ? Theme.gold : Theme.green)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .overlay(Capsule().strokeBorder(isFinal ? Theme.gold : Theme.green, lineWidth: 1))
            Text(isFinal ? "Scores are final and locked." : pending ? "Real results, waiting to be finalized. PROJ is an estimate and never counts." : "Big numbers are real results. PROJ is an estimate and never counts.")
                .font(.caption2)
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    private func projLine(_ total: Double) -> some View {
        HStack(alignment: .center, spacing: 5) {
            ProjTag()
            Text(Fmt.pts(total)).font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(Theme.muted)
                .lineLimit(1)
        }
        .fixedSize()
    }

    private func resultBadge(my: Double, their: Double) -> some View {
        let text = my > their ? "W" : my < their ? "L" : "T"
        let color = my > their ? Theme.green : my < their ? Theme.red : Theme.muted
        return VStack(spacing: 2) {
            Text("FINAL").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.muted)
            Text(text)
                .font(Theme.score(18))
                .foregroundStyle(.black)
                .frame(width: 32, height: 32)
                .background(color, in: .circle)
        }
    }

    // MARK: Comparison

    private func comparison(_ league: LeagueState, me: Team, opp: Team?, week: Int) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Starters").font(.system(size: 20, weight: .bold))
                Spacer()
                Button {
                    Haptics.tap()
                    traceTeam = me.id
                } label: {
                    Label("Trace total", systemImage: "checkmark.seal").font(.caption.weight(.semibold))
                }
                .foregroundStyle(Theme.green)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            VStack(spacing: 0) {
                ForEach(Slot.starters) { slot in
                    compareRow(league, slot: slot, me: me, opp: opp, week: week)
                    if slot != Slot.starters.last { RowDivider(inset: 0) }
                }
            }
            .background(Theme.surface)

            Button {
                Haptics.tap()
                withAnimation(.snappy) { showBench.toggle() }
            } label: {
                HStack {
                    Text("Bench").font(.system(size: 20, weight: .bold))
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 14, weight: .bold))
                        .rotationEffect(.degrees(showBench ? 180 : 0))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 16)
                .padding(.top, 20)
                .padding(.bottom, 6)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if showBench {
                VStack(spacing: 0) {
                    ForEach(Slot.bench + [.IR]) { slot in
                        compareRow(league, slot: slot, me: me, opp: opp, week: week)
                        if slot != .IR { RowDivider(inset: 0) }
                    }
                }
                .background(Theme.surface)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func compareRow(_ league: LeagueState, slot: Slot, me: Team, opp: Team?, week: Int) -> some View {
        let mine = league.athleteId(teamId: me.id, week: week, slot: slot)
        let theirs = opp.flatMap { league.athleteId(teamId: $0.id, week: week, slot: slot) }
        let mySummary = eventSummary(mine)
        let theirSummary = eventSummary(theirs)
        return VStack(spacing: 2) {
            HStack(spacing: 6) {
                AthleteNameBlock(athlete: store.athlete(mine), compact: true)
                PointsButton(athleteId: mine, value: mine.map { league.points($0, week: week) }, week: week, size: 17)
                SlotSquare(slot: slot)
                PointsButton(athleteId: theirs, value: theirs.map { league.points($0, week: week) }, week: week, size: 17, alignment: .leading)
                AthleteNameBlock(athlete: store.athlete(theirs), alignment: .trailing, compact: true)
            }
            if mySummary != nil || theirSummary != nil {
                HStack(alignment: .top, spacing: 60) {
                    Text(mySummary ?? "")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(theirSummary ?? "")
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .multilineTextAlignment(.trailing)
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .opacity(slot.isStarter ? 1 : 0.8)
    }

    // MARK: Pre-draft

    private func predraft(_ league: LeagueState) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                EmptyStateView(
                    icon: "flag.2.crossed",
                    title: "Matchups start after the draft",
                    message: "When the draft ends, the full season schedule is created automatically: \(league.settings.regularWeeks) weeks, then playoffs."
                )
                if league.phaseKind == .drafting {
                    PrimaryButton(title: "Enter Draft Room", systemImage: "timer") { store.showDraftRoom = true }
                } else {
                    NavigationLink(value: LeagueRoute.draft) {
                        ChipLabel(title: "Go to Draft", systemImage: "timer")
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
    }
}

struct LiveActivityChip: View {
    let league: LeagueState
    @Environment(AppStore.self) private var store
    @State private var isRunning: Bool = false

    var body: some View {
        ChipButton(title: isRunning ? "Live Activity On" : "Live Activity", systemImage: "bolt.fill", isOn: isRunning) {
            if isRunning {
                store.stopLiveActivity()
                isRunning = false
            } else {
                store.startLiveActivity()
                refresh()
            }
        }
        .onAppear(perform: refresh)
    }

    private func refresh() {
        guard let id = store.liveActivityId(for: league) else { return }
        isRunning = LiveActivityService.shared.isRunning(id)
    }
}

/// Every matchup in a given week.
struct ScoreboardView: View {
    let initialWeek: Int
    @Environment(AppStore.self) private var store
    @State private var week: Int = 0

    var body: some View {
        Group {
            if let league = store.league {
                let shown = week == 0 ? initialWeek : week
                ScrollView {
                    VStack(spacing: 14) {
                        HStack {
                            WeekSwitcher(week: Binding(get: { shown }, set: { week = $0 }), range: 1...max(1, league.totalWeeks), label: league.weekLabel(shown))
                            Spacer()
                        }
                        let games = league.matchups(week: shown)
                        if games.isEmpty {
                            EmptyStateView(icon: "calendar", title: "No games yet", message: shown > league.settings.regularWeeks ? "Playoff matchups appear once seeding is set." : "The schedule is created after the draft.")
                        }
                        ForEach(games) { m in
                            NavigationLink(value: LeagueRoute.matchup(m.homeId, shown)) {
                                ScoreboardRow(league: league, matchup: m)
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(TrackBackground())
        .navigationTitle("Scoreboard")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ScoreboardRow: View {
    let league: LeagueState
    let matchup: Matchup

    var body: some View {
        let home = league.team(matchup.homeId)
        let away = league.team(matchup.awayId)
        let hs = league.weekScore(matchup.homeId, week: matchup.week)
        let aw = matchup.awayId.map { league.weekScore($0, week: matchup.week) }
        VStack(spacing: 10) {
            if let round = matchup.round {
                Text(round.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(matchup.kind == "playoff" ? Theme.gold : Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            side(home, score: hs, win: matchup.final && hs > (aw ?? 0), mine: home?.id == league.me)
            side(away, score: aw, win: matchup.final && (aw ?? 0) > hs, mine: away?.id == league.me)
            HStack {
                Text(matchup.final ? "FINAL" : league.isWeekLocked(matchup.week) ? "LIVE" : "UPCOMING")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(matchup.final ? Theme.muted : Theme.green)
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.faint)
            }
        }
        .card(padding: 14)
    }

    private func side(_ team: Team?, score: Double?, win: Bool, mine: Bool) -> some View {
        HStack(spacing: 10) {
            TeamLogo(team: team, size: 30)
            Text(team?.teamName ?? "Bye")
                .font(.system(size: 16, weight: mine ? .bold : .semibold))
                .foregroundStyle(team == nil ? Theme.muted : .white)
                .lineLimit(1)
            if let team { Text(team.record).font(.caption).foregroundStyle(Theme.muted) }
            Spacer()
            if win { Image(systemName: "arrowtriangle.left.fill").font(.system(size: 9)).foregroundStyle(Theme.green) }
            Text(score.map(Fmt.pts) ?? "–")
                .font(Theme.score(20))
                .foregroundStyle(win ? .white : Theme.muted.opacity(team == nil ? 0.5 : 1))
        }
    }
}

/// Live meet status strip on the matchup: LIVE / FINAL, last update, processed and matched counts.
struct LiveMeetBar: View {
    let meet: Meet
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                LiveStatusPill(status: meet.status)
                Text(meet.name).font(.system(size: 14, weight: .bold)).lineLimit(1)
                Spacer(minLength: 4)
                if meet.isLive {
                    Circle()
                        .fill(store.isRealtimeConnected ? Theme.green : Theme.gold)
                        .frame(width: 7, height: 7)
                        .accessibilityLabel(store.isRealtimeConnected ? "Live updates on" : "Reconnecting")
                }
            }
            if meet.sourceError != nil, meet.polling {
                Label("LIVE SOURCE UNAVAILABLE — scores kept, retrying", systemImage: "wifi.exclamationmark")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.red)
            }
            HStack(spacing: 14) {
                stat("Updated", MeetFmt.time(meet.lastSyncedAt))
                stat("Results", "\(meet.stats.processed)")
                stat("Matched", "\(meet.stats.matched)")
                if store.league?.isCommissioner == true {
                    stat("Unmatched", "\(meet.stats.unmatched)")
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(meet.isLive ? Theme.red.opacity(0.08) : Theme.surface, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(meet.isLive ? Theme.red.opacity(0.35) : Theme.line))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(.white)
            Text(label.uppercased()).font(.system(size: 9, weight: .heavy)).tracking(0.6).foregroundStyle(Theme.muted)
        }
    }
}
