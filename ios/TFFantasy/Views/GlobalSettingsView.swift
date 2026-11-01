import SwiftUI

/// Gold "Set by the Main League" notice used on every screen that shows global (read-only) settings.
struct MainLeagueBanner: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "globe.americas.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.gold)
                .frame(width: 32, height: 32)
                .background(Theme.gold.opacity(0.14), in: .rect(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text("SET BY THE MAIN LEAGUE").font(.system(size: 11, weight: .heavy)).tracking(0.8).foregroundStyle(Theme.gold)
                Text(text).font(.caption).foregroundStyle(.white.opacity(0.85))
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.gold.opacity(0.07), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.gold.opacity(0.25)))
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }
}

/// Main League commissioner only: the one global setup every league uses. The server re-checks permission on every save.
struct GlobalSettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var rules: GlobalScoringRules?
    @State private var game: GlobalGameSettings?
    @State private var roster: RosterRules?
    @State private var live: LiveRules?
    @State private var notices: NoticeRules?
    @State private var leagues: GlobalLeaguesBody?
    @State private var loadedVersion: Int = -1

    var body: some View {
        Form {
            if let league = store.league {
                if !league.canEditGlobalSettings {
                    Section {
                        MainLeagueBanner(text: "Only the Main League commissioner can change these. You're seeing the current global setup.")
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                header(league)
                if rules != nil { scoringSection }
                if game != nil { gameSection }
                if roster != nil { rosterSection }
                if live != nil, notices != nil { liveSection }
                Section {
                    NavigationLink(value: LeagueRoute.standards) { Label("Scoring Standards", systemImage: "ruler") }
                    NavigationLink(value: LeagueRoute.performanceTables) { Label("Performance Tables", systemImage: "chart.bar.xaxis") }
                    NavigationLink(value: LeagueRoute.meetCenter) { Label("Global Meets", systemImage: "dot.radiowaves.left.and.right") }
                } header: {
                    Text("Tables & Meets")
                }
                .listRowBackground(Theme.surface)
                if let leagues { leaguesSection(leagues) }
            }
        }
        .screenBackground()
        .disabled(!(store.league?.canEditGlobalSettings ?? false) || store.isBusy)
        .navigationTitle("Global Game Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.league?.globalVersion) {
            load()
            if store.league?.canEditGlobalSettings == true { leagues = await store.globalLeagues() }
        }
    }

    // MARK: Sections

    private func header(_ league: LeagueState) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "crown.fill").foregroundStyle(Theme.gold)
                    Text("MAIN LEAGUE • T7RAN2").font(.system(size: 12, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                }
                Text("One setup for every league").font(Theme.display(24))
                Text("Changes apply to every league and the website right away. Scoring changes count from the current week on; finished weeks never change.")
                    .font(.caption).foregroundStyle(Theme.muted)
                if let g = league.global {
                    Text("Version \(g.version) • updated \(Fmt.dateTime(g.updatedAt)) by \(g.updatedBy)")
                        .font(.caption2).foregroundStyle(Theme.faint)
                }
            }
            .padding(.vertical, 4)
        }
        .listRowBackground(Color.clear)
    }

    private var unseededTiers: [PercentileTier] {
        rules?.percentileUnseeded ?? [0.05, 0.1, 0.2, 0.3, 0.4].map { PercentileTier(pct: $0, pts: 0) }
    }

    private func unseededPointsBinding(_ i: Int) -> Binding<Double> {
        Binding<Double>(
            get: { i < unseededTiers.count ? unseededTiers[i].pts : 0 },
            set: { (v: Double) in
                guard var r = rules else { return }
                var list = unseededTiers
                guard i < list.count else { return }
                list[i].pts = v
                r.percentileUnseeded = list
                rules = r
            }
        )
    }

    private var scoringSection: some View {
        Section {
            pointsRow("Participation", binding(\.participation))
            pointsRow("Personal best (PB)", binding(\.pb))
            pointsRow("Season best (SB)", binding(\.sb))
            LabeledContent("PB that's also an SB", value: "PB points only (never stacked)")
            listRow("Individual place 1st–6th", \.overall)
            listRow("Relay place 1st–6th", \.relay)
            listRow("Heat / flight 1st–3rd", \.heat)
            ForEach(Array((rules?.percentile ?? []).enumerated()), id: \.offset) { i, t in
                pointsRow("Top \(Int((t.pct * 100).rounded()))% of seeded field", pctPointsBinding(i))
            }
            ForEach(Array(unseededTiers.enumerated()), id: \.offset) { i, t in
                pointsRow("Top \(Int((t.pct * 100).rounded()))% of unseeded section", unseededPointsBinding(i))
            }
            pointsRow("Standards cap (per season)", binding(\.standardCap))
            pointsRow("School record", binding(\.schoolRecord))
            pointsRow("Baton fumble", binding(\.fumble))
            pointsRow("DQ / DNF", binding(\.dqdnf))
            saveButton("Save Scoring") {
                guard let r = rules else { return }
                await store.perform(["type": "updateScoring", "rules": encode(r)], success: "Scoring saved for every league")
            }
        } header: {
            Text("Scoring")
        } footer: {
            Text("Applies to the current week and later in every league. Finished weeks keep the points they were scored with.")
        }
        .listRowBackground(Theme.surface)
    }

    private var gameSection: some View {
        Section {
            Picker("Pick timer", selection: gameBinding(\.pickSeconds)) {
                ForEach([30, 60, 90, 120, 300, 600, 3600], id: \.self) { s in Text(s >= 60 ? "\(s / 60) min" : "\(s) sec").tag(s) }
            }
            Stepper("Regular season: \(game?.regularWeeks ?? 0) weeks", value: gameBinding(\.regularWeeks), in: 1...20)
            Picker("Playoff teams", selection: gameBinding(\.playoffTeams)) {
                ForEach([0, 2, 4, 6, 8], id: \.self) { n in Text(n == 0 ? "No playoffs" : "\(n) teams").tag(n) }
            }
            Toggle("Consolation bracket", isOn: gameBinding(\.consolation))
            Picker("Tiebreaker", selection: gameBinding(\.tiebreaker)) {
                Text("Points for").tag("pf")
                Text("Head-to-head").tag("h2h")
            }
            Picker("Waiver type", selection: gameBinding(\.waiverType)) {
                Text("Rolling priority").tag("rolling")
                Text("Budget bidding").tag("faab")
            }
            Picker("Waiver schedule", selection: Binding(get: { game?.waiverSchedule ?? "weekly" }, set: { game?.waiverSchedule = $0 })) {
                Text("Weekly run (Yahoo)").tag("weekly")
                Text("Days after drop").tag("daily")
            }
            if (game?.waiverSchedule ?? "weekly") == "weekly" {
                Picker("Waiver day", selection: Binding(get: { game?.waiverDay ?? 3 }, set: { game?.waiverDay = $0 })) {
                    ForEach(0..<7, id: \.self) { d in Text(WeekdayName.full(d)).tag(d) }
                }
            } else {
                Stepper("Days on waivers: \(game?.waiverDays ?? 0)", value: gameBinding(\.waiverDays), in: 0...7)
            }
            Picker("Process claims at (ET)", selection: gameBinding(\.waiverHour)) {
                ForEach(0..<24, id: \.self) { h in Text(hourLabel(h)).tag(h) }
            }
            Stepper("Waiver budget: $\(game?.faabBudget ?? 0)", value: gameBinding(\.faabBudget), in: 0...1000, step: 10)
            Stepper("Weekly add limit: \((game?.maxAddsPerWeek ?? 0) == 0 ? "None" : "\(game?.maxAddsPerWeek ?? 0)")", value: gameBinding(\.maxAddsPerWeek), in: 0...20)
            Picker("Trade review", selection: gameBinding(\.tradeReview)) {
                Text("Commissioner").tag("commish")
                Text("League vote").tag("league")
                Text("None").tag("none")
            }
            Stepper("Review period: \(game?.tradeReviewDays ?? 0) day(s)", value: gameBinding(\.tradeReviewDays), in: 0...3)
            Stepper("Veto votes needed: \(game?.vetoVotes ?? 0)", value: gameBinding(\.vetoVotes), in: 1...13)
            Stepper("Trade deadline: \((game?.tradeDeadlineWeek ?? 0) == 0 ? "None" : "Week \(game?.tradeDeadlineWeek ?? 0)")", value: gameBinding(\.tradeDeadlineWeek), in: 0...20)
            Picker("Lineup lock", selection: gameBinding(\.lineupLock)) {
                Text("When each event starts").tag("results")
                Text("Commissioner locks").tag("manual")
            }
            saveButton("Save Game Rules") {
                guard let g = game else { return }
                var body = encode(g)
                body["tzOffsetMin"] = TimeZone.current.secondsFromGMT() / 60
                await store.perform(["type": "updateGlobalSettings", "settings": body], success: "Game rules saved for every league")
            }
        } header: {
            Text("Game Rules")
        } footer: {
            Text("Season length, playoff teams and consolation apply right away to leagues that haven't drafted. Leagues already drafted switch at their next season. Draft time, draft order and league size stay with each league.")
        }
        .listRowBackground(Theme.surface)
    }

    private var rosterSection: some View {
        Section {
            LabeledContent("Spots", value: "SPR • DIS • FLD • FLEX • BN • BN • IR")
            Toggle("Allow the IR spot", isOn: Binding(get: { roster?.irSlot ?? true }, set: { roster?.irSlot = $0 }))
            statusToggle("IR", "Injured Reserve")
            statusToggle("O", "Out")
            statusToggle("Q", "Questionable")
            posToggle("SPR", "Sprinters can play FLEX")
            posToggle("DIS", "Distance can play FLEX")
            posToggle("FLD", "Field can play FLEX")
            saveButton("Save Roster Rules") {
                guard let r = roster else { return }
                await store.perform(["type": "updateRoster", "roster": encode(r)], success: "Roster rules saved for every league")
            }
        } header: {
            Text("Roster & Positions")
        } footer: {
            Text("Who can fill FLEX and IR in every league. Players already locked into a spot this week stay put.")
        }
        .listRowBackground(Theme.surface)
    }

    private var liveSection: some View {
        Section {
            Stepper("Check results every \(live?.pollSeconds ?? 15)s", value: Binding(get: { live?.pollSeconds ?? 15 }, set: { live?.pollSeconds = $0 }), in: 10...300, step: 5)
            Stepper("Auto-final after \(live?.autoFinalMinutes ?? 30) quiet min", value: Binding(get: { live?.autoFinalMinutes ?? 30 }, set: { live?.autoFinalMinutes = $0 }), in: 5...240, step: 5)
            Stepper("Pause live after \(live?.maxLiveHours ?? 16) hours", value: Binding(get: { live?.maxLiveHours ?? 16 }, set: { live?.maxLiveHours = $0 }), in: 2...72)
            noticeToggle("Player updates", \.player)
            noticeToggle("Live scoring", \.live)
            noticeToggle("Trades", \.trades)
            noticeToggle("Waivers", \.waivers)
            noticeToggle("Draft", \.draft)
            noticeToggle("League news", \.league)
            saveButton("Save Live & Notifications") {
                guard let l = live, let n = notices else { return }
                await store.perform(["type": "updateLive", "live": encode(l)])
                await store.perform(["type": "updateNotices", "notices": encode(n)], success: "Saved for every league")
            }
        } header: {
            Text("Live Scoring & Notifications")
        } footer: {
            Text("A switched-off alert type is still listed in each league's notification center but isn't pushed. Each person's own switches still apply.")
        }
        .listRowBackground(Theme.surface)
    }

    private func leaguesSection(_ body: GlobalLeaguesBody) -> some View {
        Section {
            ForEach(body.leagues) { l in
                HStack(spacing: 10) {
                    Image(systemName: l.isMainLeague ? "crown.fill" : l.upToDate ? "checkmark.circle.fill" : "clock.arrow.circlepath")
                        .foregroundStyle(l.isMainLeague ? Theme.gold : l.upToDate ? Theme.green : Theme.muted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text("\(l.code) • \(l.upToDate ? "Up to date" : "Updating…")\(l.shapePending ? " • season shape at next draft" : "")")
                            .font(.caption).foregroundStyle(l.shapePending ? Theme.gold : Theme.muted)
                    }
                }
            }
        } header: {
            Text("Leagues (\(body.leagues.count))")
        }
        .listRowBackground(Theme.surface)
    }

    // MARK: Rows

    private func pointsRow(_ label: String, _ value: Binding<Double>) -> some View {
        Stepper(value: value, in: -50...100, step: 0.5) {
            HStack {
                Text(label)
                Spacer()
                Text(Fmt.signed(value.wrappedValue)).font(.body.monospacedDigit().weight(.bold)).foregroundStyle(value.wrappedValue < 0 ? Theme.red : Theme.green)
            }
        }
    }

    private func listRow(_ label: String, _ key: WritableKeyPath<GlobalScoringRules, [Double]>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline)
            HStack(spacing: 6) {
                ForEach(Array((rules?[keyPath: key] ?? []).enumerated()), id: \.offset) { i, _ in
                    TextField("0", value: listBinding(key, i), format: .number)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.center)
                    .font(.subheadline.monospacedDigit().weight(.bold))
                    .frame(minWidth: 36, minHeight: 36)
                    .background(Theme.surface2, in: .rect(cornerRadius: 8))
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func pctPointsBinding(_ i: Int) -> Binding<Double> {
        Binding<Double>(
            get: {
                guard let list = rules?.percentile, i < list.count else { return 0 }
                return list[i].pts
            },
            set: { (v: Double) in
                guard var r = rules, i < r.percentile.count else { return }
                r.percentile[i].pts = v
                rules = r
            }
        )
    }

    private func listBinding(_ key: WritableKeyPath<GlobalScoringRules, [Double]>, _ i: Int) -> Binding<Double> {
        Binding<Double>(
            get: {
                let list: [Double] = rules?[keyPath: key] ?? []
                return i < list.count ? list[i] : 0
            },
            set: { (v: Double) in
                guard var r = rules else { return }
                var list: [Double] = r[keyPath: key]
                guard i < list.count else { return }
                list[i] = v
                r[keyPath: key] = list
                rules = r
            }
        )
    }

    private func statusToggle(_ code: String, _ label: String) -> some View {
        Toggle("\(label) can use IR", isOn: Binding(
            get: { roster?.irStatuses.contains(code) ?? false },
            set: { on in
                guard var r = roster else { return }
                r.irStatuses.removeAll { $0 == code }
                if on { r.irStatuses.append(code) }
                roster = r
            }
        ))
        .disabled(!(roster?.irSlot ?? true))
    }

    private func posToggle(_ code: String, _ label: String) -> some View {
        Toggle(label, isOn: Binding(
            get: { roster?.flexPositions.contains(code) ?? false },
            set: { on in
                guard var r = roster else { return }
                r.flexPositions.removeAll { $0 == code }
                if on { r.flexPositions.append(code) }
                if !r.flexPositions.isEmpty { roster = r } else { Haptics.warning() }
            }
        ))
    }

    private func noticeToggle(_ label: String, _ key: WritableKeyPath<NoticeRules, Bool>) -> some View {
        Toggle("Send \(label.lowercased()) alerts", isOn: Binding(get: { notices?[keyPath: key] ?? true }, set: { notices?[keyPath: key] = $0 }))
    }

    private func saveButton(_ title: String, run: @escaping () async -> Void) -> some View {
        Button {
            Haptics.tap()
            Task { await run() }
        } label: {
            HStack {
                Spacer()
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundStyle(Theme.green)
                Spacer()
            }
        }
    }

    // MARK: Helpers

    private func binding(_ key: WritableKeyPath<GlobalScoringRules, Double>) -> Binding<Double> {
        Binding(get: { rules?[keyPath: key] ?? 0 }, set: { rules?[keyPath: key] = $0 })
    }

    private func gameBinding<T>(_ key: WritableKeyPath<GlobalGameSettings, T>) -> Binding<T> where T: Hashable {
        Binding(get: { (game ?? Self.fallback)[keyPath: key] }, set: { game?[keyPath: key] = $0 })
    }

    private static let fallback = GlobalGameSettings(
        pickSeconds: 90, regularWeeks: 8, playoffTeams: 4, consolation: false, tiebreaker: "pf", waiverType: "rolling", waiverSchedule: "weekly", waiverDay: 3, waiverDays: 2,
        waiverHour: 3, tzOffsetMin: -240, faabBudget: 100, maxAddsPerWeek: 0, tradeReview: "commish", tradeReviewDays: 1, vetoVotes: 3,
        tradeDeadlineWeek: 0, lineupLock: "results"
    )

    private func load() {
        guard let g = store.league?.global, g.version != loadedVersion else { return }
        loadedVersion = g.version
        rules = g.rules
        game = g.settings
        roster = g.roster
        live = g.live
        notices = g.notices
    }

    private func encode<T: Encodable>(_ value: T) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    private func hourLabel(_ h: Int) -> String {
        var c = DateComponents()
        c.hour = h
        return (Calendar.current.date(from: c) ?? .now).formatted(date: .omitted, time: .shortened)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
