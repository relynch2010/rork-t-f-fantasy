import SwiftUI

/// Commissioner Tools hub — only reachable by the commissioner.
struct CommissionerView: View {
    @Environment(AppStore.self) private var store
    @State private var confirmFinalize: Bool = false
    @State private var confirmLock: Bool = false
    @State private var confirmWaivers: Bool = false
    @State private var confirmReset: Bool = false
    @State private var confirmResetFinal: Bool = false

    var body: some View {
        List {
            if let league = store.league {
                if !league.isCommissioner {
                    Text("Only the commissioner can use these tools.").listRowBackground(Theme.surface)
                } else {
                    Section {
                        if league.canEditGlobalSettings {
                            link(.adminPanel, "lock.shield.fill", "Admin Panel", league.isMain ? "Scoring drafts, projection health, data checks, change history" : "Sandbox for this league only · Main League untouched", tint: Theme.gold)
                        }
                        if league.canEditGlobalSettings {
                            link(.globalSettings, "globe.americas.fill", "Global Game Settings", "Scoring, rules, roster, meets and alerts for every league", tint: Theme.gold)
                        } else {
                            link(.globalSettings, "globe.americas.fill", "Global Game Settings", "Set by the Main League. View only", tint: Theme.muted)
                        }
                    } header: {
                        Text(league.isMain ? "Main League" : "Game Setup")
                    }
                    Section {
                        let live = league.liveMeetCount
                        link(.meetCenter, "dot.radiowaves.left.and.right", "Meet Center", live > 0 ? "\(live) meet\(live == 1 ? "" : "s") LIVE — scoring automatically" : league.ownsMeets ? "Schedule this league's meets" : league.canEditGlobalSettings ? "Global meets for every league" : "Meets set by the Main League")
                        let open = league.unmatchedCount ?? 0
                        link(.unmatched, "person.fill.questionmark", "Unmatched Results", open == 0 ? "Nothing to review" : "\(open) need your review", tint: open > 0 ? Theme.gold : Theme.green)
                        link(.integrity, "checkmark.shield.fill", "Scoring Integrity", "Health, Reconcile Scores, alert log, snapshots, versions", tint: Theme.green)
                        link(.pushDiagnostics, "bell.and.waves.left.and.right.fill", "Test Notification", "Send a real push to this iPhone and see every delivery step", tint: Theme.gold)
                        if league.canEditGlobalSettings {
                            link(.meetLab, "testtube.2", "Meet Test Lab", "Replay a past AthleticLIVE meet. Never touches any league", tint: Theme.flex)
                        }
                    } header: {
                        Text("Live Scoring")
                    }
                    Section {
                        link(.results, "list.bullet.rectangle", "Results & Corrections", "Fix a live result, DQ/DNF, or remove a manual entry")
                        link(.enterResult(nil), "square.and.pencil", "Manual Result", "Only if a result is missing from the live source")
                        link(.scoringLab, "flask.fill", "Scoring Lab", "Seeded vs unseeded, relay options, projection accuracy · real meets, preview only", tint: Theme.gold)
                        link(.scoringRules, "slider.horizontal.3", "Scoring Rules", league.canEditGlobalSettings ? "Categories, points, brackets · preview before publishing" : "Set by the Main League. View only", tint: league.canEditGlobalSettings ? Theme.gold : Theme.muted)
                        link(.standards, "ruler", "Scoring Standards", league.canEditGlobalSettings ? "NB, Nike and States Super marks (global)" : "Set by the Main League. View only")
                        link(.performanceTables, "chart.bar.xaxis", "Performance Tables", league.canEditGlobalSettings ? "Time and mark point tiers (global)" : "Set by the Main League. View only")
                        link(.schoolRecord, "rosette", "Mark School Record", "+10, once per athlete, event and season")
                        link(.fumble, "exclamationmark.triangle", "Add Baton Fumble", "−5 to the athlete")
                    } header: {
                        Text("Scoring")
                    }
                    if league.phaseKind == .season {
                        Section {
                            if league.settings.lineupLock == "manual" && !league.isLineupLocked {
                                action("lock.fill", "Lock \(league.weekLabel(league.week)) Lineups", "Freeze every lineup for this week", Theme.gold) { confirmLock = true }
                            }
                            action("flag.checkered", "Finalize \(league.weekLabel(league.week))", finalizeSubtitle(league), Theme.green) { confirmFinalize = true }
                            if !league.waivers.isEmpty {
                                action("tray.and.arrow.down.fill", "Process Waivers Now", "\(league.waivers.count) on waivers. Runs every pending claim in priority order", Theme.gold) { confirmWaivers = true }
                            }
                        } header: {
                            Text("This Week")
                        }
                    }
                    Section {
                        link(.editSettings, "slider.horizontal.3", "League Settings", "Name, league size, draft time and order")
                        if league.phaseKind == .season || league.phaseKind == .complete {
                            link(.schedule, "calendar", "Season Schedule", "Every week's matchups, checks, and confirmed changes", tint: Theme.green)
                        }
                        link(.draft, "list.number", "Draft Controls", league.phaseKind == .predraft ? "Set order, start the draft" : "Draft results")
                        link(.manageTeams, "person.2", "Manage Teams", "Remove a team, change commissioner")
                        link(.athletes, "figure.run", "Athlete Editor", league.ownsMeets ? "\(league.athletes.count) \(league.schoolName) athletes · import a roster" : (league.canEditPlayers ?? false) ? "\(league.athletes.count) athletes — master player database (every league)" : "Set by the Main League. View only", tint: (league.canEditPlayers ?? false) ? Theme.green : Theme.muted)
                        let flagged = (league.adpReview ?? []).filter(\.needsReview).count
                        link(.adpReview, "list.star", "Draft Rankings", flagged == 0 ? "ADP order for the draft room" : "\(flagged) names need review", tint: flagged > 0 ? Theme.gold : Theme.green)
                        link(.audit, "doc.text.magnifyingglass", "Audit Log", "Every manual scoring change")
                    } header: {
                        Text("League · \(league.schoolName)")
                    }
                    Section {
                        if league.phaseKind != .predraft || !league.draft.picks.isEmpty {
                            action("arrow.counterclockwise", "Reset Draft", "Erase draft picks and rosters for this league only", Theme.red) { confirmReset = true }
                        }
                        link(.deleteLeague, "trash.fill", "Delete League", "Permanently remove this league for everyone", tint: Theme.red)
                    } header: {
                        Text("Danger Zone")
                    }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Commissioner Tools")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Finalize this week?", isPresented: $confirmFinalize, titleVisibility: .visible) {
            Button("Finalize Week") { Task { await store.perform(["type": "finalizeWeek"], success: "Week finalized") } }
        } message: {
            Text("Only for weeks without a meet. Weeks with a meet close automatically when the meet is marked final.")
        }
        .confirmationDialog("Process waivers now?", isPresented: $confirmWaivers, titleVisibility: .visible) {
            Button("Process Waivers") { Task { await store.perform(["type": "runWaivers"], success: "Waivers processed") } }
        } message: {
            Text("Every pending claim is decided now instead of at the scheduled time.")
        }
        .alert("Reset Draft?", isPresented: $confirmReset) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) { confirmResetFinal = true }
        } message: {
            Text("This will erase the current draft progress and draft results for this league and return the league to the pre-draft state.")
        }
        .alert("Are you sure?", isPresented: $confirmResetFinal) {
            Button("Cancel", role: .cancel) {}
            Button("Reset Draft", role: .destructive) {
                Task { await store.perform(["type": "resetDraft", "confirm": "RESET", "requestId": UUID().uuidString], success: "Draft reset. The league is back to pre-draft.") }
            }
        } message: {
            Text("Picks, drafted rosters and the schedule are cleared. Members, team names, global settings, players and every other league stay the same. A backup is saved first.")
        }
        .confirmationDialog("Lock lineups now?", isPresented: $confirmLock, titleVisibility: .visible) {
            Button("Lock Lineups") { Task { await store.perform(["type": "lockLineups"], success: "Lineups locked") } }
        }
    }

    private func finalizeSubtitle(_ league: LeagueState) -> String {
        if league.week == league.settings.regularWeeks, league.settings.playoffTeams > 0 { return "Ends the regular season and seeds the playoffs" }
        if league.week >= league.totalWeeks { return "Final week — crowns the champion" }
        if league.week > league.settings.regularWeeks { return "Advances the bracket" }
        return "Records W/L and opens week \(league.week + 1)"
    }

    private func link(_ route: LeagueRoute, _ icon: String, _ title: String, _ subtitle: String, tint: Color = Theme.green) -> some View {
        NavigationLink(value: route) {
            ToolRow(icon: icon, title: title, subtitle: subtitle, tint: tint)
        }
        .listRowBackground(Theme.surface)
    }

    private func action(_ icon: String, _ title: String, _ subtitle: String, _ tint: Color, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            ToolRow(icon: icon, title: title, subtitle: subtitle, tint: tint)
        }
        .listRowBackground(Theme.surface)
    }
}

struct ToolRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let tint: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(tint.opacity(0.14), in: .rect(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                Text(subtitle).font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Edit settings

/// Per-league settings only: name, league size, draft time and draft order. Every game rule comes from the Main League.
struct EditSettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var loaded: Bool = false
    @State private var name: String = ""
    @State private var maxTeams: Int = 10
    @State private var hasDraftDate: Bool = false
    @State private var draftDate: Date = .now.addingTimeInterval(86_400)
    @State private var orderMode: String = "random"

    var body: some View {
        Form {
            if let league = store.league {
                let pre = league.phaseKind == .predraft
                Section("League") {
                    TextField("League name", text: $name)
                    Stepper("Max teams: \(maxTeams)", value: $maxTeams, in: max(2, league.teams.count)...14).disabled(!pre)
                }
                Section {
                    Toggle("Scheduled draft time", isOn: $hasDraftDate).disabled(!pre || draftTimeLocked(league))
                    if hasDraftDate {
                        DatePicker("Draft", selection: $draftDate, in: Date.now.addingTimeInterval(1800)..., displayedComponents: [.date, .hourAndMinute])
                            .disabled(!pre || draftTimeLocked(league))
                    }
                    Picker("Draft order", selection: $orderMode) {
                        Text("Random").tag("random")
                        Text("Set manually").tag("manual")
                    }
                    .disabled(!pre)
                } header: {
                    Text("Draft")
                } footer: {
                    Text(!pre ? "Draft settings lock once the draft starts." : draftTimeLocked(league) ? "The draft time is locked. It's less than 30 minutes away." : "Snake draft, 6 rounds. The draft time can be changed until 30 minutes before it starts.")
                }
                Section {
                    MainLeagueBanner(text: league.canEditGlobalSettings ? "You're the Main League commissioner. Change these for every league in Global Game Settings." : "Scoring, season length, playoffs, waivers, trades and lineup rules are the same in every league.")
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    let s = league.settings
                    LabeledContent("Pick timer", value: s.pickSeconds >= 60 ? "\(s.pickSeconds / 60) min" : "\(s.pickSeconds) sec")
                    LabeledContent("Regular season", value: "\(s.regularWeeks) weeks")
                    LabeledContent("Playoff teams", value: s.playoffTeams == 0 ? "No playoffs" : "\(s.playoffTeams) teams")
                    LabeledContent("Waivers", value: s.isFAAB ? "Budget bidding ($\(s.faabBudget))" : "Rolling priority")
                    LabeledContent("Days on waivers", value: "\(s.waiverDays)")
                    LabeledContent("Trade review", value: s.tradeReview == "commish" ? "Commissioner" : s.tradeReview == "league" ? "League vote" : "None")
                    LabeledContent("Trade deadline", value: s.tradeDeadlineWeek == 0 ? "None" : "Week \(s.tradeDeadlineWeek)")
                    LabeledContent("Lineup lock", value: s.lineupLock == "manual" ? "Commissioner locks" : "When each event starts")
                    if league.shapePending ?? false {
                        Text("New season length and playoff settings apply at this league's next draft.")
                            .font(.caption).foregroundStyle(Theme.gold)
                    }
                    NavigationLink(value: LeagueRoute.globalSettings) {
                        Label(league.canEditGlobalSettings ? "Edit Global Game Settings" : "View Global Game Settings", systemImage: "globe.americas.fill")
                    }
                } header: {
                    Text("Game Rules")
                }
                .listRowBackground(Theme.surface)
            }
        }
        .screenBackground()
        .navigationTitle("League Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }.fontWeight(.bold).disabled(store.isBusy)
            }
        }
        .onAppear(perform: load)
    }

    private func draftTimeLocked(_ league: LeagueState) -> Bool {
        guard let at = league.settings.draftAt else { return false }
        return at - store.serverNowMs < 30 * 60 * 1000
    }

    private func load() {
        guard !loaded, let league = store.league else { return }
        loaded = true
        let s = league.settings
        name = league.name
        maxTeams = s.maxTeams
        hasDraftDate = s.draftAt != nil
        if let at = s.draftAt { draftDate = Date(timeIntervalSince1970: at / 1000) }
        orderMode = s.draftOrderMode
    }

    private func save() {
        var body: [String: Any] = [
            "type": "updateSettings",
            "name": name,
            "maxTeams": maxTeams,
            "draftOrderMode": orderMode,
        ]
        if let league = store.league, league.phaseKind == .predraft, !draftTimeLocked(league) {
            body["draftAt"] = hasDraftDate ? (draftDate.timeIntervalSince1970 * 1000).rounded() : 0
        }
        Task {
            if await store.perform(body, success: "Settings saved") { dismiss() }
        }
    }
}

// MARK: - Manage teams

struct ManageTeamsView: View {
    @Environment(AppStore.self) private var store
    @State private var removeTarget: Team?
    @State private var commishTarget: Team?

    var body: some View {
        List {
            if let league = store.league {
                Section {
                    ForEach(league.teams) { t in
                        HStack(spacing: 12) {
                            TeamLogo(team: t, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(t.teamName).font(.system(size: 16, weight: .semibold))
                                    if t.id == league.commissionerId { Image(systemName: "crown.fill").font(.caption).foregroundStyle(Theme.gold) }
                                }
                                Text(t.ownerName).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if t.id != league.commissionerId {
                                Menu {
                                    Button("Make Commissioner", systemImage: "crown") { commishTarget = t }
                                    if league.phaseKind == .predraft {
                                        Button("Remove Team", systemImage: "trash", role: .destructive) { removeTarget = t }
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44)
                                }
                            }
                        }
                        .listRowBackground(Theme.surface)
                    }
                } footer: {
                    Text("Teams can be removed before the draft. Handing off commissioner removes your tools.")
                }
            }
        }
        .screenBackground()
        .navigationTitle("Manage Teams")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Remove \(removeTarget?.teamName ?? "")?", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
            Button("Remove Team", role: .destructive) {
                guard let t = removeTarget else { return }
                Task { await store.perform(["type": "removeTeam", "teamId": t.id], success: "\(t.teamName) removed") }
            }
        }
        .confirmationDialog("Make \(commishTarget?.ownerName ?? "") commissioner?", isPresented: Binding(get: { commishTarget != nil }, set: { if !$0 { commishTarget = nil } }), titleVisibility: .visible) {
            Button("Hand Off Commissioner") {
                guard let t = commishTarget else { return }
                Task { await store.perform(["type": "setCommissioner", "teamId": t.id], success: "\(t.ownerName) is now commissioner") }
            }
        } message: {
            Text("You'll lose access to Commissioner Tools.")
        }
    }
}
