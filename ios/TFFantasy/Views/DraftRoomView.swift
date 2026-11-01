import SwiftUI

enum DraftTab: String, CaseIterable, Identifiable {
    case players = "Players"
    case queue = "Queue"
    case results = "Draft Results"
    case roster = "My Roster"
    var id: String { rawValue }
}

/// Full-screen Yahoo-style live draft room.
struct DraftRoomView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var tab: DraftTab = .players
    @State private var pos: PosFilter = .all
    @State private var query: String = ""
    @State private var confirmAthlete: Athlete?

    var body: some View {
        NavigationStack {
            Group {
                if let league = store.league {
                    VStack(spacing: 0) {
                        clock(league)
                        tabBar
                        switch tab {
                        case .players: playersList(league)
                        case .queue: queueList(league)
                        case .results: resultsBoard(league)
                        case .roster: rosterList(league)
                        }
                    }
                }
            }
            .background(TrackBackground())
            .navigationTitle("Live Draft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        store.showDraftRoom = false
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Leave draft room")
                }
                if let league = store.league, league.isCommissioner, league.phaseKind == .drafting {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            if league.draft.status == "paused" {
                                Button("Resume Draft", systemImage: "play.fill") { Task { await store.perform(["type": "resumeDraft"]) } }
                            } else {
                                Button("Pause Draft", systemImage: "pause.fill") { Task { await store.perform(["type": "pauseDraft"]) } }
                            }
                        } label: {
                            Image(systemName: "wrench.and.screwdriver.fill")
                        }
                    }
                }
            }
            .confirmationDialog("Draft \(confirmAthlete?.name ?? "")?", isPresented: Binding(get: { confirmAthlete != nil }, set: { if !$0 { confirmAthlete = nil } }), titleVisibility: .visible) {
                Button("Draft") {
                    guard let a = confirmAthlete else { return }
                    let pickNumber = (store.league?.draft.picks.count ?? 0) + 1
                    Task { await store.perform(["type": "pick", "athleteId": a.id, "pickNumber": pickNumber], success: "You drafted \(a.name)") }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: Clock

    private func clock(_ league: LeagueState) -> some View {
        let onClock = league.team(league.teamOnClock)
        let n = league.draft.picks.count
        let count = max(1, league.draft.order.count)
        let mine = league.teamOnClock == league.me
        return VStack(spacing: 10) {
            if league.phaseKind == .predraft {
                Text("Waiting for the draft to start").font(Theme.display(24))
                Text("Build your queue now — auto-pick uses it if you miss your turn.")
                    .font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            } else if league.phaseKind != .drafting {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.green)
                    Text("Draft complete — season schedule is live").font(.headline)
                }
            } else {
                HStack(alignment: .center, spacing: 14) {
                    TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                        let remaining: Int = {
                            if league.draft.status == "paused" { return Int((league.draft.pausedRemaining ?? 0) / 1000) }
                            guard let d = league.draft.deadline else { return 0 }
                            return Int(ceil((d - store.serverNowMs) / 1000))
                        }()
                        let urgent = remaining <= 10 && league.draft.status != "paused"
                        VStack(spacing: 0) {
                            Text(league.draft.status == "paused" ? "PAUSED" : Fmt.clock(remaining))
                                .font(Theme.score(league.draft.status == "paused" ? 22 : 38))
                                .foregroundStyle(urgent ? Theme.red : mine ? Theme.green : .white)
                                .contentTransition(.numericText(countsDown: true))
                                .animation(.snappy, value: remaining)
                            Text("PICK CLOCK").font(.system(size: 9, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
                        }
                        .frame(width: 104, height: 78)
                        .background(Theme.surface2, in: .rect(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(mine ? Theme.green : Theme.line, lineWidth: mine ? 2 : 1))
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Round \(n / count + 1) • Pick \(n % count + 1)  (#\(n + 1))")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                        HStack(spacing: 8) {
                            TeamLogo(team: onClock, size: 26)
                            Text(mine ? "You're on the clock!" : onClock?.teamName ?? "")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(mine ? Theme.green : .white)
                                .lineLimit(1)
                        }
                        if !mine, let next = league.nextPickIndex(for: league.me) {
                            let away = next - n
                            Text("Your next pick: #\(next + 1) (\(away) pick\(away == 1 ? "" : "s") away)")
                                .font(.caption)
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    Spacer(minLength: 0)
                    Circle()
                        .fill(store.isRealtimeConnected ? Theme.green : Theme.gold)
                        .frame(width: 8, height: 8)
                        .accessibilityLabel(store.isRealtimeConnected ? "Live connection" : "Reconnecting")
                }
                recentPicks(league)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(Theme.surface)
    }

    private func recentPicks(_ league: LeagueState) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(league.draft.picks.suffix(8).reversed(), id: \.overall) { p in
                    let a = store.athlete(p.athleteId)
                    HStack(spacing: 6) {
                        Text("\(p.round).\(String(format: "%02d", p.pickInRound))")
                            .font(.system(size: 11, weight: .heavy).monospacedDigit())
                            .foregroundStyle(Theme.muted)
                        Text(a?.shortName ?? "")
                            .font(.system(size: 12, weight: .heavy).width(.condensed))
                        Text(a?.posShort ?? "")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(PosStyle.color(a))
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(Theme.surface2, in: .capsule)
                }
            }
        }
        .scrollClipDisabled()
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(DraftTab.allCases) { t in
                Button {
                    Haptics.tap()
                    withAnimation(.snappy) { tab = t }
                } label: {
                    VStack(spacing: 8) {
                        Text(t.rawValue)
                            .font(.system(size: 14, weight: tab == t ? .bold : .medium))
                            .foregroundStyle(tab == t ? .white : Theme.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Rectangle().fill(tab == t ? Theme.green : .clear).frame(height: 3)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    // MARK: Players

    private func canDraft(_ league: LeagueState) -> Bool {
        league.phaseKind == .drafting && league.draft.status == "live" && league.teamOnClock == league.me
    }

    private func playersList(_ league: LeagueState) -> some View {
        let taken = Set(league.draft.picks.map(\.athleteId))
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let adp = league.adpRankMap
        let list = league.athletes
            .filter { !taken.contains($0.id) && pos.matches($0) && (trimmed.isEmpty || $0.name.localizedStandardContains(trimmed)) }
            .sorted { (adp[$0.id] ?? 10_000 + $0.rank) < (adp[$1.id] ?? 10_000 + $1.rank) }
        let queue = league.myTeam?.queue ?? []
        return ScrollView {
            LazyVStack(spacing: 0) {
                VStack(spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                        TextField("Search athletes", text: $query).autocorrectionDisabled()
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(Theme.surface2, in: .capsule)
                    .padding(.horizontal, 16)
                    ChipRow {
                        ForEach(PosFilter.allCases) { option in
                            ChipButton(title: option.rawValue, isOn: pos == option) { pos = option }
                        }
                    }
                }
                .padding(.vertical, 12)
                HStack {
                    Text("ADP").frame(width: 26)
                    Text("Player")
                    Spacer()
                }
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(Theme.faint)
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
                ForEach(list) { a in
                    HStack(spacing: 10) {
                        Text("\((adp[a.id] ?? a.rank) + 1)")
                            .font(.system(size: 12, weight: .semibold).monospacedDigit())
                            .foregroundStyle(Theme.faint)
                            .frame(width: 26)
                        AthleteBadge(athlete: a, size: 38)
                        AthleteNameBlock(athlete: a, compact: true)
                        Button {
                            toggleQueue(a.id, queue: queue)
                        } label: {
                            Image(systemName: queue.contains(a.id) ? "star.fill" : "star")
                                .foregroundStyle(queue.contains(a.id) ? Theme.gold : Theme.muted)
                                .frame(width: 40, height: 44)
                        }
                        .accessibilityLabel("Queue")
                        if canDraft(league) {
                            Button {
                                Haptics.tap()
                                confirmAthlete = a
                            } label: {
                                Text("Draft")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(.black)
                                    .padding(.horizontal, 14)
                                    .frame(height: 32)
                                    .background(Theme.green, in: .capsule)
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Theme.surface)
                    RowDivider(inset: 86)
                }
            }
            .padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    private func toggleQueue(_ id: String, queue: [String]) {
        Haptics.tap()
        var q = queue
        if q.contains(id) { q.removeAll { $0 == id } } else { q.append(id) }
        Task { await store.perform(["type": "setQueue", "ids": q]) }
    }

    // MARK: Queue

    private func queueList(_ league: LeagueState) -> some View {
        let queue = league.myTeam?.queue ?? []
        return Group {
            if queue.isEmpty {
                ScrollView {
                    EmptyStateView(icon: "star", title: "Your queue is empty", message: "Star athletes in the Players tab. If your clock runs out, we draft the top queued athlete who fits your roster.")
                }
            } else {
                List {
                    Section {
                        ForEach(queue, id: \.self) { id in
                            let a = store.athlete(id)
                            HStack(spacing: 10) {
                                AthleteBadge(athlete: a, size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a?.shortName ?? "").font(.system(size: 15, weight: .heavy).width(.condensed))
                                    PosLabel(athlete: a)
                                }
                                Spacer()
                                if canDraft(league), let a {
                                    Button("Draft") { confirmAthlete = a }
                                        .font(.system(size: 14, weight: .bold))
                                        .buttonStyle(.borderedProminent)
                                        .tint(Theme.green)
                                        .foregroundStyle(.black)
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                        .onMove { from, to in
                            var q = queue
                            q.move(fromOffsets: from, toOffset: to)
                            Task { await store.perform(["type": "setQueue", "ids": q]) }
                        }
                        .onDelete { offsets in
                            var q = queue
                            q.remove(atOffsets: offsets)
                            Task { await store.perform(["type": "setQueue", "ids": q]) }
                        }
                    } footer: {
                        Text("Drag to reorder. Swipe to remove. Auto-pick takes the first athlete that fits.")
                    }
                }
                .scrollContentBackground(.hidden)
                .environment(\.editMode, .constant(.active))
            }
        }
    }

    // MARK: Results board

    private func resultsBoard(_ league: LeagueState) -> some View {
        let count = max(1, league.draft.order.count)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                ForEach(1...max(1, league.draft.rounds), id: \.self) { round in
                    Section {
                        ForEach(0..<count, id: \.self) { i in
                            let index = (round - 1) * count + i
                            let pick = league.draft.picks.first { $0.overall == index + 1 }
                            let teamId = league.teamForPick(index)
                            let team = league.team(teamId)
                            let a = store.athlete(pick?.athleteId)
                            HStack(spacing: 10) {
                                Text("\(round).\(String(format: "%02d", i + 1))")
                                    .font(.system(size: 12, weight: .bold).monospacedDigit())
                                    .foregroundStyle(Theme.muted)
                                    .frame(width: 40, alignment: .leading)
                                TeamLogo(team: team, size: 24)
                                Text(team?.teamName ?? "")
                                    .font(.system(size: 13))
                                    .foregroundStyle(teamId == league.me ? Theme.green : Theme.muted)
                                    .lineLimit(1)
                                    .frame(width: 96, alignment: .leading)
                                if let a {
                                    Text(a.shortName).font(.system(size: 14, weight: .heavy).width(.condensed)).lineLimit(1)
                                    Text(a.posShort).font(.system(size: 11, weight: .bold)).foregroundStyle(PosStyle.color(a))
                                    if pick?.auto == true {
                                        Text("AUTO").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.faint)
                                    }
                                } else if index == league.draft.picks.count, league.phaseKind == .drafting {
                                    Text("ON THE CLOCK").font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.green)
                                } else {
                                    Text("—").foregroundStyle(Theme.faint)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .background(index == league.draft.picks.count && league.phaseKind == .drafting ? Theme.green.opacity(0.08) : Theme.surface)
                            RowDivider(inset: 16)
                        }
                    } header: {
                        Text("ROUND \(round)\(round % 2 == 0 ? "  ↩" : "")")
                            .font(.system(size: 12, weight: .heavy))
                            .tracking(1)
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.bg)
                    }
                }
            }
            .padding(.bottom, 30)
        }
    }

    // MARK: Roster

    private func rosterList(_ league: LeagueState) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(Slot.allCases) { slot in
                    let a = store.athlete(league.myTeam?.athlete(in: slot))
                    HStack(spacing: 12) {
                        SlotPill(slot: slot)
                        AthleteBadge(athlete: a, size: 40)
                        AthleteNameBlock(athlete: a)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Theme.surface)
                    RowDivider(inset: 74)
                }
                Text("6 rounds fill Sprinter, Distance, Field, Flex and both Bench spots. Sprinter, Distance and Field only take that position. The IR spot starts empty.")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .padding(16)
            }
        }
    }
}
