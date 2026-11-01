import SwiftUI
import PhotosUI

enum PointsMode: String, CaseIterable, Identifiable {
    case week = "This Week (total)"
    case season = "Season (total)"
    var id: String { rawValue }
}

/// Yahoo "My Team" screen. `teamId == nil` shows the signed-in user's team.
struct TeamView: View {
    let teamId: String?

    @Environment(AppStore.self) private var store
    @State private var week: Int = 0
    @State private var mode: PointsMode = .week
    @State private var selected: Slot?
    @State private var showRename: Bool = false
    @State private var newName: String = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker: Bool = false
    @State private var showCoManager: Bool = false

    var body: some View {
        Group {
            if let league = store.league, let team = league.team(teamId ?? league.me) {
                content(league, team)
            } else {
                EmptyStateView(icon: "person.3", title: "No team", message: "This team isn't in the league.")
            }
        }
        .background(TrackBackground())
        .leagueChrome()
    }

    private func content(_ league: LeagueState, _ team: Team) -> some View {
        let isMine = team.id == league.me
        let shownWeek = week == 0 ? league.displayWeek : week
        let editable = isMine && league.isInSeason && shownWeek == league.week && !league.isLineupLock(shownWeek)
        return ScrollView {
            VStack(spacing: 0) {
                header(league, team, week: shownWeek, isMine: isMine)
                chips(league, team, week: shownWeek, editable: editable)
                if league.phaseKind == .predraft || league.phaseKind == .drafting, team.roster.isEmpty {
                    predraftCard(league)
                        .padding(16)
                } else {
                    if isMine, league.isInSeason, let bad = league.irProblem(for: team.id, athletes: store.athleteMap) {
                        irBanner(bad, editable: editable)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                    }
                    if shownWeek < league.week, let m = league.matchup(for: team.id, week: shownWeek) {
                        pastWeekCard(league, team: team, matchup: m, week: shownWeek)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                    }
                    section("Starters", league: league, team: team, slots: Slot.starters, week: shownWeek, editable: editable)
                    section("Bench", league: league, team: team, slots: Slot.bench, week: shownWeek, editable: editable)
                    section("IR", league: league, team: team, slots: [.IR], week: shownWeek, editable: editable)
                }
            }
            .padding(.bottom, 40)
        }
        .onChange(of: week) { _, _ in selected = nil }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    store.sheet = .crop(data)
                } else {
                    store.errorMessage = "That photo couldn't be loaded. Try another one."
                }
                photoItem = nil
            }
        }
        .sheet(isPresented: $showCoManager) { CoManagerSheet(teamId: team.id).environment(store) }
        .alert("Rename team", isPresented: $showRename) {
            TextField("Team name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                Task { await store.perform(["type": "renameTeam", "teamName": newName], success: "Team renamed") }
            }
        }
    }

    // MARK: Header

    private func header(_ league: LeagueState, _ team: Team, week: Int, isMine: Bool) -> some View {
        let total = mode == .week ? league.weekScore(team.id, week: week) : team.pointsFor
        return HStack(alignment: .center, spacing: 12) {
            Button {
                guard isMine else { return }
                Haptics.tap()
                showPhotoPicker = true
            } label: {
                TeamLogo(team: team, size: 56)
                    .overlay(alignment: .bottomTrailing) {
                        if isMine {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.black)
                                .frame(width: 20, height: 20)
                                .background(Theme.green, in: .circle)
                                .overlay(Circle().strokeBorder(Theme.bg, lineWidth: 2))
                        }
                    }
            }
            .buttonStyle(PressableStyle())
            .disabled(!isMine)
            .accessibilityLabel(isMine ? "Change team photo" : team.teamName)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(team.teamName)
                        .font(.system(size: 20, weight: .bold))
                        .lineLimit(1)
                    if isMine {
                        Menu {
                            Button("Rename Team", systemImage: "pencil") {
                                newName = team.teamName
                                showRename = true
                            }
                            Button("Change Team Photo", systemImage: "photo") { showPhotoPicker = true }
                            Button(league.isCoManager ? "Co-manager" : "Co-manager…", systemImage: "person.2.fill") { showCoManager = true }
                        } label: {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 30, height: 30)
                        }
                        .accessibilityLabel("Rename team")
                    }
                }
                Text("\(team.record) • \(ordinalRank(team.rank)) of \(league.teams.count) • \(team.ownerName)\(team.coManagerName.map { " & \($0)" } ?? "")")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.pts(total))
                    .font(Theme.score(30))
                    .contentTransition(.numericText())
                Text(mode == .week ? league.weekLabel(week).uppercased() : "SEASON")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }

    private func chips(_ league: LeagueState, _ team: Team, week: Int, editable: Bool) -> some View {
        VStack(spacing: 10) {
            ChipRow {
                if league.totalWeeks > 0, league.phaseKind == .season || league.phaseKind == .complete {
                    WeekSwitcher(
                        week: Binding(get: { week }, set: { self.week = $0 }),
                        range: 1...max(1, min(league.totalWeeks, league.week)),
                        label: league.weekLabel(week)
                    )
                }
                Menu {
                    Picker("Points", selection: $mode) {
                        ForEach(PointsMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                } label: {
                    ChipLabel(title: mode.rawValue, trailingChevron: true)
                }
                NavigationLink(value: LeagueRoute.transactions) {
                    ChipLabel(title: "Transactions", systemImage: "arrow.left.arrow.right")
                }
                .buttonStyle(.plain)
                if league.isInSeason {
                    NavigationLink(value: LeagueRoute.waivers) {
                        ChipLabel(title: "Waivers", systemImage: "tray.and.arrow.down", badge: league.pendingClaims.count)
                    }
                    .buttonStyle(.plain)
                }
            }
            ChipRow {
                if editable {
                    if selected != nil {
                        ChipButton(title: "Cancel Move", systemImage: "xmark", isOn: true) { selected = nil }
                    } else {
                        ChipLabel(title: "Tap a position to move", systemImage: "arrow.up.arrow.down")
                    }
                    ChipButton(title: "Start Active Players", systemImage: "bolt.fill") {
                        selected = nil
                        Task { await store.perform(["type": "optimizeLineup"], success: "Best lineup set") }
                    }
                } else if team.id == league.me, league.isInSeason {
                    ChipLabel(title: week < league.week ? "Past week • Locked" : "Lineup locked", systemImage: "lock.fill")
                }
                if team.id != league.me, league.isInSeason {
                    ChipButton(title: "Propose Trade", systemImage: "arrow.left.arrow.right") {
                        store.sheet = .trade(toId: team.id, get: [], counterOf: nil)
                    }
                }
                if league.settings.isFAAB, team.id == league.me {
                    ChipLabel(title: "Budget $\(team.faab)", systemImage: "dollarsign.circle")
                } else if team.id == league.me, league.isInSeason {
                    ChipLabel(title: "Waiver #\(team.waiverPriority)", systemImage: "list.number")
                }
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: Rows

    private func section(_ title: String, league: LeagueState, team: Team, slots: [Slot], week: Int, editable: Bool) -> some View {
        VStack(spacing: 0) {
            ColumnHeader(title: title, trailing: [mode == .week ? "Points" : "Season"])
            VStack(spacing: 0) {
                ForEach(slots) { slot in
                    let aid = league.athleteId(teamId: team.id, week: week, slot: slot)
                    row(league: league, slot: slot, athleteId: aid, week: week, editable: editable, team: team)
                    if slot != slots.last { RowDivider(inset: 76) }
                }
            }
            .background(Theme.surface)
        }
    }

    private func row(league: LeagueState, slot: Slot, athleteId: String?, week: Int, editable: Bool, team: Team) -> some View {
        let athlete = store.athlete(athleteId)
        let state = pillState(slot: slot, team: team, editable: editable)
        let value: Double? = athleteId.map { mode == .week ? (league.points[$0]?["\(week)"]) : league.seasonPoints($0) } ?? nil
        return HStack(spacing: 12) {
            Button {
                tapSlot(slot, team: team, editable: editable)
            } label: {
                SlotPill(slot: slot, state: state)
            }
            .buttonStyle(PressableStyle())
            .disabled(!editable || state == .disabled)
            AthleteBadge(athlete: athlete, size: 44)
                .overlay(alignment: .bottomTrailing) {
                    if week == league.week, let lock = league.lock(for: athleteId) {
                        LockBadge(lock: lock)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                AthleteNameBlock(athlete: athlete)
                if week == league.week, let lock = league.lock(for: athleteId) {
                    Text("LOCKED \(Fmt.time(lock.at)) · \(lock.event)")
                        .font(.system(size: 10, weight: .heavy).monospacedDigit())
                        .tracking(0.4)
                        .foregroundStyle(Theme.gold)
                        .lineLimit(1)
                }
            }
            if state == .target {
                Button {
                    tapSlot(slot, team: team, editable: editable)
                } label: {
                    Text(athlete == nil ? "MOVE HERE" : "SWAP")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(Theme.green, in: .capsule)
                }
                .buttonStyle(PressableStyle())
                .transition(.scale.combined(with: .opacity))
            } else {
                PointsButton(athleteId: athleteId, value: athleteId == nil ? nil : (value ?? (mode == .season ? 0 : nil)), week: mode == .week ? week : nil)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 16)
        .padding(.vertical, 8)
        .background(state == .selected ? Theme.green.opacity(0.14) : state == .target ? Theme.green.opacity(0.04) : .clear)
        .opacity(state == .disabled ? 0.45 : 1)
        .animation(.snappy, value: selected)
    }

    private func isLocked(_ slot: Slot, team: Team) -> Bool {
        store.league?.lock(for: team.athlete(in: slot)) != nil
    }

    private func pillState(slot: Slot, team: Team, editable: Bool) -> SlotPillState {
        guard editable else { return .normal }
        if isLocked(slot, team: team) { return selected == nil ? .normal : .disabled }
        guard let sel = selected else { return .editable }
        if sel == slot { return .selected }
        return canSwap(sel, slot, team: team) ? .target : .disabled
    }

    private func canSwap(_ a: Slot, _ b: Slot, team: Team) -> Bool {
        let aa = store.athlete(team.athlete(in: a))
        let bb = store.athlete(team.athlete(in: b))
        if aa == nil && bb == nil { return false }
        if isLocked(a, team: team) || isLocked(b, team: team) { return false }
        if let aa, !b.accepts(aa) { return false }
        if let bb, !a.accepts(bb) { return false }
        return true
    }

    private func tapSlot(_ slot: Slot, team: Team, editable: Bool) {
        guard editable else { return }
        if selected == nil, isLocked(slot, team: team), let aid = team.athlete(in: slot) {
            Haptics.error()
            store.errorMessage = "\(store.athlete(aid)?.name ?? "This player") is locked. Their event started, so they stay in this spot until the week is final."
            return
        }
        Haptics.tap()
        guard let sel = selected else {
            selected = slot
            return
        }
        if sel == slot {
            selected = nil
            return
        }
        guard canSwap(sel, slot, team: team) else { return }
        let moving = team.athlete(in: sel)
        let body: [String: Any] = moving != nil
            ? ["type": "moveAthlete", "athleteId": moving ?? "", "slot": slot.rawValue]
            : ["type": "moveAthlete", "athleteId": team.athlete(in: slot) ?? "", "slot": sel.rawValue]
        selected = nil
        Task { await store.perform(body) }
    }

    private func irBanner(_ a: Athlete, editable: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title3)
                .foregroundStyle(Theme.gold)
            VStack(alignment: .leading, spacing: 4) {
                Text("Move \(a.name) out of IR").font(.subheadline.weight(.bold))
                Text("They're listed \(a.playerStatus.label) now. You can't add or claim players until IR only holds an IR or Out player.")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                if editable {
                    Button("Move out of IR") {
                        Haptics.tap()
                        selected = .IR
                    }
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(Theme.gold)
                    .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Theme.gold.opacity(0.1), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.gold.opacity(0.5)))
    }

    /// Past-week result card: opponent, final score and W/L/T, from that week's saved lineups.
    private func pastWeekCard(_ league: LeagueState, team: Team, matchup: Matchup, week: Int) -> some View {
        let my = league.weekScore(team.id, week: week)
        let oppId = matchup.opponent(of: team.id)
        let opp = league.team(oppId)
        let their = oppId.map { league.weekScore($0, week: week) } ?? 0
        let badge = !matchup.final ? "–" : oppId == nil ? "BYE" : my > their ? "W" : my < their ? "L" : "T"
        let color: Color = badge == "W" ? Theme.green : badge == "L" ? Theme.red : Theme.muted
        return NavigationLink(value: LeagueRoute.matchup(team.id, week)) {
            HStack(spacing: 12) {
                Text(badge)
                    .font(Theme.display(18))
                    .foregroundStyle(.black)
                    .frame(width: 36, height: 36)
                    .background(color, in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(opp.map { "vs \($0.teamName)" } ?? "Bye week").font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(matchup.final ? "Final" : "In progress").font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                Text("\(Fmt.pts(my)) – \(opp == nil ? "–" : Fmt.pts(their))")
                    .font(Theme.score(18))
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.faint)
            }
            .card(padding: 12)
        }
        .buttonStyle(PressableStyle())
    }

    private func predraftCard(_ league: LeagueState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(league.phaseKind == .drafting ? "The draft is live" : "Your roster fills on draft day")
                .font(Theme.display(24))
            Text("6 rounds, snake order. Picks fill Sprinter, Distance, Field, Flex and 2 Bench. The IR spot starts empty.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
            PrimaryButton(title: league.phaseKind == .drafting ? "Enter Draft Room" : "Go to Draft", systemImage: "timer") {
                if league.phaseKind == .drafting { store.showDraftRoom = true }
            }
            .overlay {
                if league.phaseKind == .predraft {
                    NavigationLink(value: LeagueRoute.draft) { Color.clear }
                }
            }
        }
        .card()
    }

    private func ordinalRank(_ n: Int) -> String {
        let suffix: String
        switch (n % 100, n % 10) {
        case (11...13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}

extension LeagueState {
    func isLineupLock(_ week: Int) -> Bool { isWeekLocked(week) }
}

/// Small gold padlock shown on a player whose event has started.
struct LockBadge: View {
    let lock: PlayerLock

    var body: some View {
        Image(systemName: "lock.fill")
            .font(.system(size: 9, weight: .black))
            .foregroundStyle(.black)
            .frame(width: 18, height: 18)
            .background(Theme.gold, in: .circle)
            .overlay(Circle().strokeBorder(Theme.bg, lineWidth: 2))
            .accessibilityLabel("Locked since \(lock.event) started")
    }
}
