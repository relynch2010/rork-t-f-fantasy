import SwiftUI

// MARK: - Commissioner: season tools

/// Commissioner Tools section: indoor/outdoor, start a new season, past seasons.
struct SeasonToolsSection: View {
    let league: LeagueState
    @Environment(AppStore.self) private var store
    @State private var showNewSeason: Bool = false

    var body: some View {
        Section {
            if league.phaseKind == .predraft {
                Picker(selection: Binding(
                    get: { league.seasonType ?? "" },
                    set: { v in Task { await store.perform(["type": "setSeasonType", "seasonType": v], success: v == "indoor" ? "Indoor season" : "Outdoor season") } }
                )) {
                    if league.seasonType == nil { Text("Not set").tag("") }
                    Text("Indoor").tag("indoor")
                    Text("Outdoor").tag("outdoor")
                } label: {
                    Label("Season", systemImage: "sun.max.fill")
                }
                .disabled(store.isBusy)
                .listRowBackground(Theme.surface)
            } else {
                HStack {
                    Label("Season", systemImage: "sun.max.fill")
                    Spacer()
                    Text(league.seasonLabel ?? String(league.season)).foregroundStyle(Theme.muted)
                }
                .listRowBackground(Theme.surface)
            }
            if league.canStartNewSeason ?? false {
                Button { showNewSeason = true } label: {
                    ToolRow(icon: "arrow.triangle.2.circlepath", title: "Start New Season", subtitle: "Archive this season and draft again", tint: Theme.gold)
                }
                .listRowBackground(Theme.surface)
            }
            NavigationLink(value: LeagueRoute.pastSeasons) {
                ToolRow(icon: "archivebox.fill", title: "Past Seasons", subtitle: pastSubtitle, tint: Theme.green)
            }
            .listRowBackground(Theme.surface)
        } header: {
            Text("Seasons")
        } footer: {
            if !(league.canStartNewSeason ?? false) {
                Text("Cornwall Central leagues follow the Main League's shared meet calendar, so their next season starts with the platform.")
            }
        }
        .sheet(isPresented: $showNewSeason) { NewSeasonSheet(league: league) }
    }

    private var pastSubtitle: String {
        let n = league.archives?.count ?? 0
        return n == 0 ? "None yet" : "\(n) archived season\(n == 1 ? "" : "s")"
    }
}

struct NewSeasonSheet: View {
    let league: LeagueState
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var type: String = "outdoor"
    @State private var confirm: String = ""
    @State private var sending: Bool = false

    private var running: Bool { league.phaseKind == .season }
    private var ready: Bool { confirm.trimmingCharacters(in: .whitespaces) == "NEW SEASON" && !sending }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This season is saved to Past Seasons with its standings, matchups, rosters, moves and champion. Then rosters, lineups and the schedule are cleared so the league can draft again. Members and team names stay. A backup is saved first.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                    if running {
                        Label("The season is still running. Starting now ends it early, and the current leader is recorded as champion.", systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(Theme.gold)
                    }
                }
                Section("New season") {
                    Picker("Season", selection: $type) {
                        Text("Indoor").tag("indoor")
                        Text("Outdoor").tag("outdoor")
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    TextField("Type NEW SEASON", text: $confirm)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Past points stay in the archive and in each athlete's PB/SB history. They never count in the new season.")
                }
                Section {
                    Button(role: .destructive) { send() } label: {
                        HStack {
                            Text(running ? "End Season & Start New" : "Start New Season").font(.system(size: 16, weight: .heavy))
                            Spacer()
                            if sending { ProgressView() }
                        }
                    }
                    .disabled(!ready)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("New Season")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .onAppear { type = league.seasonType == "outdoor" ? "indoor" : "outdoor" }
        }
        .presentationDetents([.large])
    }

    private func send() {
        guard ready else { return }
        sending = true
        Task {
            let ok = await store.perform(["type": "startNewSeason", "seasonType": type, "confirm": "NEW SEASON", "endEarly": running], success: "New season started. The old one is in Past Seasons.")
            sending = false
            if ok { dismiss() }
        }
    }
}

// MARK: - Past seasons (every member)

struct PastSeasonsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        List {
            let archives = store.league?.archives ?? []
            if archives.isEmpty {
                ContentUnavailableView("No past seasons yet", systemImage: "archivebox", description: Text("When the commissioner starts a new season, the finished one is saved here."))
                    .listRowBackground(Color.clear)
            }
            ForEach(archives) { a in
                NavigationLink(value: LeagueRoute.seasonArchive(a.id)) {
                    HStack(spacing: 14) {
                        Image(systemName: "trophy.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.gold)
                            .frame(width: 40, height: 40)
                            .background(Theme.gold.opacity(0.14), in: .rect(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(a.label).font(Theme.display(20))
                            Text("Champion: \(a.champion ?? "None")\(a.endedEarly ? " · ended early" : "")")
                                .font(.footnote)
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
                .listRowBackground(Theme.surface)
            }
        }
        .screenBackground()
        .navigationTitle("Past Seasons")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SeasonArchiveView: View {
    let archiveId: String
    @Environment(AppStore.self) private var store
    @State private var archive: SeasonArchive?
    @State private var loading: Bool = true
    @State private var tab: Int = 0

    var body: some View {
        List {
            if let a = archive {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("CHAMPION").font(.system(size: 11, weight: .heavy)).tracking(1.2).foregroundStyle(Theme.gold)
                        Text(a.champion ?? "No champion").font(Theme.display(30))
                        Text("Saved \(Fmt.dateTime(a.finishedAt))\(a.endedEarly ? " · season ended early" : "")")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 6)
                    Picker("View", selection: $tab) {
                        Text("Standings").tag(0)
                        Text("Matchups").tag(1)
                        Text("Rosters").tag(2)
                        Text("Moves").tag(3)
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(Theme.surface)
                switch tab {
                case 0: standings(a)
                case 1: matchups(a)
                case 2: rosters(a)
                default: moves(a)
                }
            } else if loading {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else {
                ContentUnavailableView("Couldn't load this season", systemImage: "archivebox").listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .navigationTitle(archive?.label ?? "Season")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            archive = await store.seasonArchive(archiveId)
            loading = false
        }
    }

    private func standings(_ a: SeasonArchive) -> some View {
        Section("Final Standings") {
            ForEach(a.standings, id: \.teamId) { s in
                HStack {
                    Text("\(s.rank)").font(Theme.display(18)).foregroundStyle(s.rank == 1 ? Theme.gold : Theme.muted).frame(width: 26)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.teamName).font(.system(size: 15, weight: .bold))
                        Text(s.ownerName).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(s.wins ?? 0)-\(s.losses ?? 0)\((s.ties ?? 0) > 0 ? "-\(s.ties ?? 0)" : "")").font(.system(size: 15, weight: .heavy).monospacedDigit())
                        Text("\(Fmt.pts(s.pointsFor ?? 0)) PF").font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                .listRowBackground(Theme.surface)
            }
        }
    }

    private func matchups(_ a: SeasonArchive) -> some View {
        let groups = Dictionary(grouping: a.matchups, by: \.week).sorted { $0.key < $1.key }
        return ForEach(groups, id: \.key) { week, rows in
            Section(rows.first?.label ?? "Week \(week)") {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, m in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(m.home ?? "TBD").font(.system(size: 14, weight: .semibold))
                            Text(m.away ?? "Bye").font(.system(size: 14, weight: .semibold))
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text(Fmt.pts(m.homeScore ?? 0)).monospacedDigit()
                            Text(m.awayScore.map(Fmt.pts) ?? "—").monospacedDigit()
                        }
                        .font(.system(size: 14, weight: .heavy))
                        if !(m.final ?? false) {
                            Text("NOT FINAL").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.gold)
                        }
                    }
                    .listRowBackground(Theme.surface)
                }
            }
        }
    }

    private func rosters(_ a: SeasonArchive) -> some View {
        ForEach(a.rosters, id: \.teamId) { r in
            Section("\(r.teamName) · \(r.ownerName)") {
                if r.athletes.isEmpty { Text("No athletes").foregroundStyle(Theme.muted).listRowBackground(Theme.surface) }
                ForEach(Array(r.athletes.enumerated()), id: \.offset) { _, n in
                    Text(n).listRowBackground(Theme.surface)
                }
            }
        }
    }

    private func moves(_ a: SeasonArchive) -> some View {
        Section("Transactions") {
            if a.transactions.isEmpty { Text("No moves").foregroundStyle(Theme.muted).listRowBackground(Theme.surface) }
            ForEach(Array(a.transactions.reversed().enumerated()), id: \.offset) { _, t in
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.text).font(.subheadline)
                    Text(Fmt.dateTime(t.at)).font(.caption).foregroundStyle(Theme.muted)
                }
                .listRowBackground(Theme.surface)
            }
        }
    }
}

// MARK: - Leaving a league

/// "Leave League" for League Settings. Before the draft only; a commissioner picks who takes over.
struct LeaveLeagueSection: View {
    let league: LeagueState
    @Environment(AppStore.self) private var store
    @State private var showSheet: Bool = false

    var body: some View {
        if league.role != "co", league.team(league.me) != nil {
            Section {
                Button(role: .destructive) { showSheet = true } label: {
                    Label("Leave League", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .listRowBackground(Theme.surface)
            } footer: {
                Text(league.phaseKind == .predraft
                     ? (league.isCommissioner ? "You'll pick a member to take over as commissioner first." : "Your team is removed before the draft. You can rejoin with the invite code.")
                     : "After the draft your team stays until the season ends, so every matchup still has an opponent. You can hide the league from Home instead.")
            }
            .sheet(isPresented: $showSheet) { LeaveLeagueSheet(league: league) }
        }
    }
}

struct LeaveLeagueSheet: View {
    let league: LeagueState
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var successor: String = ""
    @State private var sending: Bool = false

    private var others: [Team] { league.teams.filter { $0.id != league.me } }
    private var needsSuccessor: Bool { league.isCommissioner && !others.isEmpty }
    private var canSend: Bool { !sending && league.phaseKind == .predraft && (!needsSuccessor || !successor.isEmpty) }

    var body: some View {
        NavigationStack {
            Form {
                if league.phaseKind != .predraft {
                    Section {
                        Label("Your team stays in \(league.name) until the season ends because its matchups are already scheduled.", systemImage: "lock.fill")
                            .foregroundStyle(Theme.gold)
                        if league.isCommissioner {
                            Text("To step down as commissioner, use Commissioner Tools › Manage Teams › Make Commissioner.")
                                .font(.footnote)
                                .foregroundStyle(Theme.muted)
                        }
                    }
                } else {
                    Section {
                        Text("Your team and its draft spot are removed from \(league.name).").foregroundStyle(Theme.muted)
                    }
                    if needsSuccessor {
                        Section {
                            Picker("New commissioner", selection: $successor) {
                                Text("Choose a member").tag("")
                                ForEach(others) { t in Text("\(t.ownerName) · \(t.teamName)").tag(t.id) }
                            }
                        } header: {
                            Text("Who takes over?")
                        } footer: {
                            Text("They get commissioner tools right away and a notification. Recorded in the audit log.")
                        }
                    }
                    Section {
                        Button(role: .destructive) { send() } label: {
                            HStack {
                                Text("Leave League").font(.system(size: 16, weight: .heavy))
                                Spacer()
                                if sending { ProgressView() }
                            }
                        }
                        .disabled(!canSend)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Leave League")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func send() {
        guard canSend else { return }
        sending = true
        Task {
            let ok = await store.leaveLeague(successor: needsSuccessor ? successor : nil)
            sending = false
            if ok { dismiss() }
        }
    }
}

// MARK: - Account deletion hand-off

/// Shown when the server refuses account deletion because this account commissions leagues with other members.
struct DeleteHandoffSheet: View {
    let needs: [HandoffNeed]
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var picks: [String: String] = [:]
    @State private var current: [HandoffNeed] = []
    @State private var sending: Bool = false

    private var ready: Bool { !sending && current.allSatisfy { !(picks[$0.leagueId] ?? "").isEmpty } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("You're the commissioner of \(current.count == 1 ? "a league" : "\(current.count) leagues") with other members. Pick who takes over each one so no league is left without a commissioner.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                ForEach(current) { n in
                    Section(n.name) {
                        Picker("New commissioner", selection: Binding(get: { picks[n.leagueId] ?? "" }, set: { picks[n.leagueId] = $0 })) {
                            Text("Choose a member").tag("")
                            ForEach(n.others) { o in Text("\(o.ownerName) · \(o.teamName)").tag(o.teamId) }
                        }
                    }
                }
                Section {
                    Button(role: .destructive) { send() } label: {
                        HStack {
                            Text("Hand Off & Delete Account").font(.system(size: 16, weight: .heavy))
                            Spacer()
                            if sending { ProgressView() }
                        }
                    }
                    .disabled(!ready)
                } footer: {
                    Text("Each new commissioner is notified, and the change is recorded in that league's audit log.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Before You Go")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { current = needs }
        }
    }

    private func send() {
        guard ready else { return }
        sending = true
        Task {
            if let more = await store.deleteAccount(handoffs: picks) {
                // Membership changed meanwhile: ask again for whatever is still missing.
                current = more
            }
            sending = false
        }
    }
}

// MARK: - Platform commissioner transfer

struct PlatformTransferSection: View {
    @Environment(AppStore.self) private var store
    @State private var email: String = ""
    @State private var confirm: String = ""

    private var ready: Bool { email.contains("@") && confirm == "TRANSFER" && !store.isBusy }

    var body: some View {
        Section {
            TextField("New holder's account email", text: $email)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Type TRANSFER", text: $confirm)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button("Transfer Platform Role", role: .destructive) {
                Task { if await store.transferPlatformRole(email: email.trimmingCharacters(in: .whitespaces)) { email = ""; confirm = "" } }
            }
            .disabled(!ready)
        } header: {
            Text("Platform Commissioner")
        } footer: {
            Text("The platform commissioner controls universal scoring, scoring history, results sources, identity conflicts and league oversight. Transferring moves these tools to another existing account. Your Main League team and commissioner role there stay as they are.")
        }
        .listRowBackground(Theme.surface)
    }
}
