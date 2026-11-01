import SwiftUI

enum MeetFmt {
    static func time(_ ms: Double?) -> String {
        guard let ms else { return "Never" }
        return Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .standard)
    }
}

// MARK: - Meet Center

/// Commissioner Tools → Meet Center: one meet per week, each with its live result source.
struct MeetCenterView: View {
    @Environment(AppStore.self) private var store
    @State private var confirmPause: Bool = false

    var body: some View {
        List {
            if let league = store.league {
                if league.ownsMeets {
                    Section { MainLeagueBanner(text: "\(league.schoolName) leagues schedule their own meets. Each meet you add here belongs to this league only.") }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                } else if !league.canEditGlobalSettings {
                    Section { MainLeagueBanner(text: "Meets are set by the Main League and shared with every league. Your league scores them against its own rosters and lineups.") }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    if league.canManageMeets {
                        NavigationLink(value: LeagueRoute.meetEditor(nil)) {
                            ToolRow(icon: "plus.circle.fill", title: "Add Meet", subtitle: league.ownsMeets ? "A meet for this league: week and live result source" : "Global meet for every league: week and live result source", tint: Theme.green)
                        }
                        .listRowBackground(Theme.surface)
                    }
                    let open = league.unmatchedCount ?? 0
                    NavigationLink(value: LeagueRoute.unmatched) {
                        ToolRow(icon: "person.fill.questionmark", title: "Unmatched Results", subtitle: open == 0 ? "Nothing to review" : "\(open) need your review", tint: open == 0 ? Theme.muted : Theme.gold)
                    }
                    .listRowBackground(Theme.surface)
                    if league.canEditGlobalSettings {
                        NavigationLink(value: LeagueRoute.meetLab) {
                            ToolRow(icon: "testtube.2", title: "Meet Test Lab", subtitle: "Replay a past AthleticLIVE meet. Never touches any league", tint: Theme.flex)
                        }
                        .listRowBackground(Theme.surface)
                        if league.liveMeetCount > 0 {
                            Button { confirmPause = true } label: {
                                ToolRow(icon: "pause.circle.fill", title: "Pause All Live Scoring", subtitle: "Stops every live meet in every league. Scores are kept", tint: Theme.gold)
                            }
                            .listRowBackground(Theme.surface)
                        } else if league.allMeets.contains(where: { $0.isGlobal && $0.isLive && !$0.polling }) {
                            Button {
                                Task { await store.perform(["type": "resumeAllLive"], success: "Live scoring resumed") }
                            } label: {
                                ToolRow(icon: "play.circle.fill", title: "Resume Live Scoring", subtitle: "Restarts every paused live meet", tint: Theme.green)
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                } footer: {
                    Text(league.ownsMeets && league.isCommissioner ? "Add each meet with its live result link. The server reads the results and scores this league's matchups automatically." : league.canEditGlobalSettings ? "Set up each meet once for the whole game. The server reads results once, then every league matches its own rostered athletes and updates its matchups automatically." : "You can still review unmatched athletes for your league.")
                }

                let meets = league.allMeets.sorted { ($0.week, $0.createdAt) > ($1.week, $1.createdAt) }
                if meets.isEmpty {
                    EmptyStateView(icon: "dot.radiowaves.left.and.right", title: "No meets yet", message: "Add this week's meet and paste its AthleticLIVE feed URLs.")
                        .listRowBackground(Color.clear)
                } else {
                    Section("Meets") {
                        ForEach(meets) { m in
                            NavigationLink(value: LeagueRoute.meet(m.id)) {
                                MeetRow(meet: m)
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Meet Center")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Pause live scoring everywhere?", isPresented: $confirmPause, titleVisibility: .visible) {
            Button("Pause All Live Scoring", role: .destructive) { Task { await store.perform(["type": "pauseAllLive"], success: "Live scoring paused") } }
        } message: {
            Text("Every live meet stops checking for results in every league. Existing scores are kept.")
        }
    }
}

struct MeetRow: View {
    let meet: Meet

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(meet.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Spacer(minLength: 4)
                if meet.isArchived {
                    Text("ARCHIVED").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.faint)
                }
                LiveStatusPill(status: meet.status, compact: true)
            }
            Text("Week \(meet.week)\(meet.date.isEmpty ? "" : " • \(Fmt.isoDay(meet.date))") • \(meet.providerLabel)")
                .font(.caption).foregroundStyle(Theme.muted)
            if meet.sourceError != nil, meet.polling {
                Label("Live source unavailable", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.red)
            } else if meet.syncCount > 0 {
                Text("\(meet.stats.processed) results • \(meet.stats.relevant) fantasy athletes • \(meet.stats.unmatched) unmatched")
                    .font(.caption).foregroundStyle(Theme.faint)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Meet detail

struct MeetDetailView: View {
    let meetId: String
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirmFinal: Bool = false
    @State private var confirmDelete: Bool = false
    @State private var confirmReprocess: Bool = false

    var body: some View {
        List {
            if let league = store.league, let m = league.allMeets.first(where: { $0.id == meetId }) {
                let canEdit = m.isGlobal ? league.canEditGlobalSettings : league.isCommissioner
                if m.isGlobal && !league.canEditGlobalSettings {
                    Section { MainLeagueBanner(text: "Set by the Main League. Status, links and live scoring are controlled there for every league.") }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                } else if m.isArchived {
                    Section { MainLeagueBanner(text: "Archived league-only meet. Its points are kept, but it no longer runs. Meets are set by the Main League now.") }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            LiveStatusPill(status: m.status)
                            Spacer()
                        }
                        Text(m.name).font(Theme.display(26))
                        Text("\(league.weekLabel(m.week))\(m.date.isEmpty ? "" : " • \(Fmt.isoDay(m.date))") • \(m.providerLabel)")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                        if let info = m.sourceInfo {
                            Label("Verified: \(info.name) · \(info.date) · \(info.location)", systemImage: "checkmark.seal.fill")
                                .font(.caption.weight(.semibold)).foregroundStyle(Theme.green)
                        }
                    }
                    .listRowBackground(Color.clear)
                }

                if let err = m.sourceError {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("LIVE SOURCE UNAVAILABLE", systemImage: "wifi.exclamationmark")
                                .font(.system(size: 14, weight: .heavy)).foregroundStyle(Theme.red)
                            Text(err).font(.subheadline)
                            Text(m.polling ? "Existing scores are kept. Retrying automatically." : "Existing scores are kept.")
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                        .listRowBackground(Theme.redRow)
                    }
                }

                Section("Live Status") {
                    stat("Last updated", MeetFmt.time(m.lastSyncedAt))
                    stat("Results processed", "\(m.stats.processed)")
                    stat("Events recognized", "\(m.stats.events)")
                    stat("Fantasy athletes matched", "\(m.stats.matched)")
                    stat("On fantasy rosters this week", "\(m.stats.relevant)")
                    stat("Results scored", "\(m.stats.scored)")
                    NavigationLink(value: LeagueRoute.unmatched) {
                        stat("Unmatched", "\(m.stats.unmatched)", tint: m.stats.unmatched > 0 ? Theme.gold : .white)
                    }
                    .listRowBackground(Theme.surface)
                    if m.stats.eventsFlagged > 0 {
                        stat("Events flagged for review", "\(m.stats.eventsFlagged)", tint: Theme.gold)
                    }
                }

                if let missing = m.tablesMissing, !missing.isEmpty, league.isCommissioner {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("PERFORMANCE TABLE MISSING", systemImage: "tablecells.badge.ellipsis")
                                .font(.system(size: 13, weight: .heavy)).foregroundStyle(Theme.gold)
                            Text(missing.joined(separator: ", ")).font(.subheadline)
                            Text("These results are stored and still earn participation and placement points. No time/mark points are given until you add a table.")
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                        NavigationLink(value: LeagueRoute.performanceTables) { Text("Open Performance Tables") }
                    }
                    .listRowBackground(Theme.surface)
                }

                if let sched = m.schedule, !sched.isEmpty {
                    Section {
                        ForEach(sched.prefix(40)) { e in
                            HStack {
                                Text(e.name).font(.subheadline).lineLimit(1)
                                Spacer()
                                if let at = e.startAt {
                                    Text(Fmt.dateTime(at)).font(.caption.monospacedDigit()).foregroundStyle(at <= store.serverNowMs ? Theme.gold : Theme.muted)
                                } else {
                                    Text("Locks on first result").font(.caption).foregroundStyle(Theme.faint)
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    } header: {
                        Text("Event Schedule")
                    } footer: {
                        Text("Each player locks when their own first event starts. If no time is published, they lock when that event's first result appears.")
                    }
                }

                if let t = m.lastTest {
                    Section("Last Connection Test") {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: t.ok ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundStyle(t.ok ? Theme.green : Theme.red)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.message.isEmpty ? (t.ok ? "Connected" : "Couldn't read the source") : t.message).font(.subheadline)
                                Text("\(t.results) results • \(t.matched) matched • \(Fmt.dateTime(t.at))").font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                        .listRowBackground(Theme.surface)
                    }
                }

                if canEdit && !m.isArchived {
                Section {
                    if m.polling {
                        controlButton("STOP LIVE SCORING", "stop.fill", Theme.gold) {
                            Task { await store.perform(["type": "stopLive", "meetId": m.id], success: "Live scoring stopped") }
                        }
                    } else if !m.isFinal {
                        controlButton("START LIVE SCORING", "dot.radiowaves.left.and.right", Theme.green) {
                            Task { await store.perform(["type": "startLive", "meetId": m.id], success: "Live scoring is on") }
                        }
                    }
                    controlButton("Check for Results Now", "arrow.clockwise", .white) {
                        Task { await store.perform(["type": "syncMeet", "meetId": m.id], success: "Results checked") }
                    }
                    if m.isGlobal && m.status != "UPCOMING" {
                        controlButton("Reprocess Meet", "arrow.triangle.2.circlepath", .white) { confirmReprocess = true }
                    }
                    if m.isFinal {
                        controlButton("Reopen Meet", "arrow.uturn.backward", .white) {
                            Task { await store.perform(["type": "reopenMeet", "meetId": m.id], success: "Meet reopened") }
                        }
                    } else {
                        controlButton("MARK FINAL", "flag.checkered", Theme.green) { confirmFinal = true }
                    }
                } header: {
                    Text("Controls")
                } footer: {
                    Text(m.polling ? "Checking the source automatically for every league. Stops once the meet is final." : "Applies to every league. Placement points post only when an event's results are complete.")
                }
                }

                if canEdit {
                    Section {
                        if !m.isArchived {
                            NavigationLink(value: LeagueRoute.meetEditor(m.id)) {
                                Label("Edit Meet & Source", systemImage: "pencil")
                            }
                            .listRowBackground(Theme.surface)
                        }
                        Button(role: .destructive) { confirmDelete = true } label: {
                            Label("Delete Meet", systemImage: "trash")
                        }
                        .listRowBackground(Theme.surface)
                        .disabled(m.polling)
                    }
                }
            } else {
                EmptyStateView(icon: "questionmark.circle", title: "Meet not found", message: "It may have been deleted.")
                    .listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .navigationTitle("Meet")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Mark this meet final?", isPresented: $confirmFinal, titleVisibility: .visible) {
            Button("Mark Final") { Task { await store.perform(["type": "markFinal", "meetId": meetId], success: "Meet is final") } }
        } message: {
            Text("Runs one last check, awards final placements, and stops live scoring.")
        }
        .confirmationDialog("Reprocess this meet?", isPresented: $confirmReprocess, titleVisibility: .visible) {
            Button("Reprocess in Every League") { Task { await store.perform(["type": "reprocessMeet", "meetId": meetId], success: "Reprocessing in every league") } }
        } message: {
            Text("Re-reads the source and rebuilds this meet's results in every league. Results are replaced, never added twice.")
        }
        .confirmationDialog("Delete this meet?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Meet and Its Scores", role: .destructive) {
                Task {
                    if await store.perform(["type": "deleteMeet", "meetId": meetId, "removeScores": true], success: "Meet deleted") { dismiss() }
                }
            }
        } message: {
            Text("Every fantasy point from this meet is removed. Commissioner corrections are kept.")
        }
    }

    private func stat(_ label: String, _ value: String, tint: Color = .white) -> some View {
        HStack {
            Text(label).foregroundStyle(Theme.muted)
            Spacer()
            Text(value).font(.system(size: 16, weight: .bold).monospacedDigit()).foregroundStyle(tint)
        }
        .listRowBackground(Theme.surface)
    }

    private func controlButton(_ title: String, _ icon: String, _ tint: Color, run: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            run()
        } label: {
            Label(title, systemImage: icon)
                .font(.system(size: 15, weight: .heavy))
                .foregroundStyle(tint)
        }
        .disabled(store.isBusy)
        .listRowBackground(Theme.surface)
    }
}

// MARK: - Meet editor

struct MeetEditorView: View {
    let meetId: String?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var loaded: Bool = false
    @State private var name: String = ""
    @State private var date: Date = .now
    @State private var week: Int = 1
    @State private var provider: String = "ATHLETICLIVE"
    @State private var eventsUrl: String = ""
    @State private var rosterUrl: String = ""
    @State private var resultsUrl: String = ""
    @State private var sourceUrl: String = ""
    @State private var showAdvanced: Bool = false
    @State private var isResolving: Bool = false
    @State private var feedEvents: String = ""
    @State private var feedRoster: String = ""
    @State private var feedResults: String = ""
    @State private var test: MeetTestResult?
    @State private var isTesting: Bool = false

    var body: some View {
        Form {
            if store.league?.isMain == true {
                Section {
                    Label("Global meet: every league sees this meet, its links and its status.", systemImage: "globe")
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.gold)
                }
            }
            Section("Meet") {
                TextField("Meet name", text: $name)
                DatePicker("Meet date", selection: $date, displayedComponents: .date)
                if let league = store.league {
                    Stepper("Week: \(week)", value: $week, in: 1...max(1, max(league.totalWeeks, league.settings.regularWeeks, league.global?.settings?.regularWeeks ?? 0) + 4))
                }
                Picker("Provider", selection: $provider) {
                    Text("AthleticLIVE").tag("ATHLETICLIVE")
                    Text("Paste feed").tag("MANUAL")
                }
                LabeledContent("Status", value: currentStatus)
            }

            if provider == "ATHLETICLIVE" {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("AthleticLIVE meet link").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                        TextField("https://live.athletic.net/meets/…", text: $sourceUrl, axis: .vertical)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.system(size: 15, weight: .medium).monospaced())
                            .lineLimit(1...3)
                    }
                    .padding(.vertical, 4)
                    if let r = currentMeet?.resolve {
                        resolveBadge(r)
                    }
                    if meetId != nil {
                        Button {
                            resolve()
                        } label: {
                            HStack {
                                Label("FIND MEET DATA", systemImage: "link.badge.plus").font(.system(size: 14, weight: .heavy))
                                Spacer()
                                if isResolving { ProgressView() }
                            }
                        }
                        .disabled(isResolving || sourceUrl.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    DisclosureGroup(isExpanded: $showAdvanced) {
                        urlField("Advanced Events URL", $eventsUrl)
                        urlField("Advanced Roster URL", $rosterUrl)
                        urlField("Advanced Results URL", $resultsUrl)
                    } label: {
                        Text("Advanced (optional): override one dataset").font(.subheadline.weight(.semibold))
                    }
                } header: {
                    Text("Live Source")
                } footer: {
                    Text("Paste the meet's normal public AthleticLIVE link. The server finds and verifies the meet's events, athletes and results itself. Advanced links are optional: each one replaces only its own part.")
                }
            } else if provider == "MANUAL" {
                Section {
                    feedEditor("Results (required)", $feedResults)
                    feedEditor("Roster (optional)", $feedRoster)
                    feedEditor("Events (optional)", $feedEvents)
                } header: {
                    Text("Pasted Feed")
                } footer: {
                    Text("Paste AthleticLIVE-format data or a column-headed results CSV. It goes through the same matching and scoring as the live feed.")
                }
            }

            Section {
                Button {
                    runTest()
                } label: {
                    HStack {
                        Label("TEST CONNECTION", systemImage: "antenna.radiowaves.left.and.right")
                            .font(.system(size: 15, weight: .heavy))
                        Spacer()
                        if isTesting { ProgressView() }
                    }
                }
                .disabled(isTesting || (provider == "ATHLETICLIVE" && resultsUrl.trimmingCharacters(in: .whitespaces).isEmpty && sourceUrl.trimmingCharacters(in: .whitespaces).isEmpty) || (provider == "MANUAL" && meetId == nil))
                if provider == "MANUAL" && meetId == nil {
                    Text("Save the meet first, then test the pasted data.").font(.caption).foregroundStyle(Theme.muted)
                }
                if let test { testCard(test) }
            }

            Section {
                PrimaryButton(title: meetId == nil ? "Save Meet" : "Save Changes", systemImage: "checkmark", isLoading: store.isBusy) { save() }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
        }
        .screenBackground()
        .navigationTitle(meetId == nil ? "Add Meet" : "Edit Meet")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: provider) { _, _ in test = nil }
        .onAppear(perform: load)
    }

    private var currentMeet: Meet? { store.league?.allMeets.first { $0.id == meetId } }

    private func resolveBadge(_ r: MeetResolve) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: r.ok ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(r.ok ? Theme.green : Theme.gold)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.ok ? "MEET DATA FOUND" : "COULDN'T READ THIS MEET AUTOMATICALLY")
                    .font(.system(size: 11, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(r.ok ? Theme.green : Theme.gold)
                Text(r.message).font(.caption).foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(.vertical, 4)
    }

    private func resolve() {
        guard let id = meetId else { return }
        isResolving = true
        Task {
            let ok = await store.perform(["type": "resolveMeet", "meetId": id, "sourceUrl": sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines)])
            isResolving = false
            if ok, let m = currentMeet {
                eventsUrl = m.eventsUrl
                rosterUrl = m.rosterUrl
                resultsUrl = m.resultsUrl
                if m.resolve?.ok == false { showAdvanced = true; Haptics.warning() }
            }
        }
    }

    private var currentStatus: String {
        store.league?.allMeets.first { $0.id == meetId }?.status ?? "UPCOMING"
    }

    private func urlField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            TextField("https://", text: text)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 14).monospaced())
        }
        .padding(.vertical, 2)
    }

    private func feedEditor(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            TextEditor(text: text)
                .font(.system(size: 12).monospaced())
                .frame(minHeight: 90)
                .scrollContentBackground(.hidden)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
    }

    private func testCard(_ t: MeetTestResult) -> some View {
        LabSummaryCard(result: t)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        week = store.league?.week ?? 1
        guard let id = meetId, let m = store.league?.allMeets.first(where: { $0.id == id }) else { return }
        name = m.name
        if !m.date.isEmpty { date = EventCatalog.date(m.date) }
        week = m.week
        provider = m.provider
        eventsUrl = m.eventsUrl
        rosterUrl = m.rosterUrl
        resultsUrl = m.resultsUrl
        sourceUrl = m.sourceUrl ?? ""
        showAdvanced = sourceUrl.isEmpty && !resultsUrl.isEmpty
    }

    private func fields() -> [String: Any] {
        [
            "name": name.trimmingCharacters(in: .whitespaces),
            "date": EventCatalog.iso(date),
            "week": week,
            "provider": provider,
            "sourceUrl": sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines),
            "eventsUrl": eventsUrl.trimmingCharacters(in: .whitespacesAndNewlines),
            "rosterUrl": rosterUrl.trimmingCharacters(in: .whitespacesAndNewlines),
            "resultsUrl": resultsUrl.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
    }

    private func runTest() {
        isTesting = true
        test = nil
        var body = fields()
        body["meetId"] = meetId ?? ""
        Task {
            if provider == "MANUAL", let id = meetId, !feedResults.isEmpty {
                await store.perform(["type": "updateMeet", "meetId": id, "feedResults": feedResults, "feedRoster": feedRoster, "feedEvents": feedEvents])
            }
            test = await store.testMeet(body)
            isTesting = false
            if test?.ok == true { Haptics.success() } else { Haptics.error() }
        }
    }

    private func save() {
        var body = fields()
        Task {
            if let id = meetId {
                body["type"] = "updateMeet"
                body["meetId"] = id
                if provider == "MANUAL", !feedResults.isEmpty {
                    body["feedResults"] = feedResults
                    body["feedRoster"] = feedRoster
                    body["feedEvents"] = feedEvents
                }
                if await store.perform(body, success: "Meet saved") { dismiss() }
            } else {
                body["type"] = "createMeet"
                guard await store.perform(body, success: "Meet added") else { return }
                if provider == "MANUAL", !feedResults.isEmpty, let newest = store.league?.allMeets.max(by: { $0.createdAt < $1.createdAt }) {
                    await store.perform(["type": "updateMeet", "meetId": newest.id, "feedResults": feedResults, "feedRoster": feedRoster, "feedEvents": feedEvents])
                }
                dismiss()
            }
        }
    }
}

// MARK: - Unmatched results

struct UnmatchedResultsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                let items = store.league?.unmatched ?? []
                if items.isEmpty {
                    EmptyStateView(icon: "checkmark.seal", title: "All matched", message: "Results the server can't confidently match to a fantasy athlete show up here. Nothing is ever guessed.")
                } else {
                    Text("Confirm only when you're sure. Confirmed matches are saved and reused for every future meet.")
                        .font(.caption).foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(items.sorted { ($0.relevant ? 0 : 1, -$0.createdAt) < ($1.relevant ? 0 : 1, -$1.createdAt) }) { item in
                        UnmatchedCard(item: item)
                    }
                }
            }
            .padding(16)
        }
        .background(TrackBackground())
        .navigationTitle("Unmatched Results")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct UnmatchedCard: View {
    let item: UnmatchedItem
    @Environment(AppStore.self) private var store
    @State private var relaySelection: Set<String> = []
    @State private var pick: [String] = []
    @State private var showPicker: Bool = false
    @State private var event: String = ""
    @State private var applyToFinal: Bool = false

    /// The week this result belongs to is already final (its score is frozen until the commissioner applies a correction).
    private var finalWeek: Int? {
        guard let league = store.league, let m = league.meets?.first(where: { $0.id == item.meetId }) else { return nil }
        let games = league.schedule.filter { $0.week == m.week }
        return !games.isEmpty && games.allSatisfy(\.final) ? m.week : nil
    }

    private func confirm(_ athleteId: String) {
        var body: [String: Any] = ["type": "confirmMatch", "unmatchedId": item.id, "athleteId": athleteId]
        if applyToFinal { body["applyToFinal"] = true }
        Task { await store.perform(body, success: "Match confirmed. Points updated.") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if item.kind == "athlete" || item.kind == "relay" {
                HStack(spacing: 6) {
                    ReviewMark()
                    Text("NEEDS REVIEW").font(.system(size: 10, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                    Text("No points until you decide").font(.caption2).foregroundStyle(Theme.faint)
                }
            }
            HStack(spacing: 8) {
                Image(systemName: item.kind == "event" ? "questionmark.folder" : item.kind == "relay" ? "person.3.fill" : item.kind == "mark" ? "ruler" : "person.fill.questionmark")
                    .foregroundStyle(Theme.gold)
                Text(item.sourceName).font(.system(size: 17, weight: .bold)).lineLimit(1)
                Spacer()
                if item.relevant {
                    Text("MAY BE ROSTERED").font(.system(size: 9, weight: .heavy)).foregroundStyle(.black)
                        .padding(.horizontal, 6).padding(.vertical, 3).background(Theme.gold, in: .capsule)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                if item.kind != "event" {
                    Text([item.school, item.gender == "B" ? "Boys" : item.gender == "G" ? "Girls" : "", item.bib.isEmpty ? "" : "Bib \(item.bib)"].filter { !$0.isEmpty }.joined(separator: " • "))
                }
                Text(item.eventName).foregroundStyle(.white)
                if !item.result.isEmpty { Text(item.result) }
            }
            .font(.subheadline)
            .foregroundStyle(Theme.muted)

            switch item.kind {
            case "event": eventActions
            case "relay": relayActions
            case "mark": markActions
            default: athleteActions
            }
        }
        .card()
        .sheet(isPresented: $showPicker) {
            AthletePickerSheet(title: "Match to…", multiple: false, selection: $pick)
                .environment(store)
                .preferredColorScheme(.dark)
        }
        .onChange(of: pick) { _, ids in
            guard let id = ids.first else { return }
            confirm(id)
        }
    }

    private var athleteActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let w = finalWeek {
                Toggle(isOn: $applyToFinal) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Also correct the final Week \(w) matchup").font(.subheadline.weight(.semibold))
                        Text("Week \(w) is final. Player totals update either way; the frozen matchup score only changes if you turn this on.").font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
                .tint(Theme.gold)
            }
            ForEach(item.candidates, id: \.self) { cid in
                let a = store.athlete(cid)
                HStack(spacing: 10) {
                    AthleteBadge(athlete: a, size: 32)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(a?.name ?? cid).font(.system(size: 15, weight: .semibold))
                        Text([a?.gender.label, a?.school, store.league?.owner(of: cid)?.teamName, store.league.map { "\(Fmt.pts($0.seasonPoints(cid))) pts" }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " • "))
                            .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    Spacer()
                    Button {
                        Task { await store.perform(["type": "rejectMatch", "unmatchedId": item.id, "athleteId": cid], success: "Noted") }
                    } label: {
                        Text("NOT THIS ATHLETE").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.red)
                            .padding(.horizontal, 8).frame(height: 30).overlay(Capsule().strokeBorder(Theme.red.opacity(0.6)))
                    }
                    Button {
                        confirm(cid)
                    } label: {
                        Text("CONFIRM MATCH").font(.system(size: 10, weight: .heavy)).foregroundStyle(.black)
                            .padding(.horizontal, 8).frame(height: 30).background(Theme.green, in: .capsule)
                    }
                }
                .buttonStyle(PressableStyle())
            }
            HStack(spacing: 10) {
                SecondaryButton(title: "Other athlete", systemImage: "magnifyingglass") { showPicker = true }
                SecondaryButton(title: "Not on any team", systemImage: "xmark") {
                    Task { await store.perform(["type": "rejectMatch", "unmatchedId": item.id], success: "Dismissed") }
                }
            }
        }
    }

    /// Unreadable official time/mark: the commissioner fixes it in Results & Corrections (never guessed automatically).
    private var markActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Open Results & Corrections to enter the correct mark. This item closes automatically once it reads cleanly.")
                .font(.caption).foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                SecondaryButton(title: "Dismiss", systemImage: "xmark") {
                    Task { await store.perform(["type": "rejectMatch", "unmatchedId": item.id], success: "Dismissed") }
                }
                NavigationLink(value: LeagueRoute.results) {
                    Label("Fix mark", systemImage: "square.and.pencil")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Theme.green, in: .capsule)
                }
            }
        }
    }

    private var relayActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Who ran on this relay?").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            ForEach(item.candidates, id: \.self) { cid in
                let on = relaySelection.contains(cid)
                Button {
                    Haptics.tap()
                    if on { relaySelection.remove(cid) } else { relaySelection.insert(cid) }
                } label: {
                    HStack {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Theme.green : Theme.muted)
                        Text(store.athlete(cid)?.name ?? cid).foregroundStyle(.white)
                        Spacer()
                    }
                    .frame(minHeight: 36)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 10) {
                SecondaryButton(title: "No fantasy athletes", systemImage: "xmark") {
                    Task { await store.perform(["type": "rejectMatch", "unmatchedId": item.id], success: "Dismissed") }
                }
                PrimaryButton(title: "Confirm", systemImage: "checkmark") {
                    Task { await store.perform(["type": "confirmMatch", "unmatchedId": item.id, "athleteIds": Array(relaySelection)], success: "Relay matched") }
                }
                .disabled(relaySelection.isEmpty)
                .opacity(relaySelection.isEmpty ? 0.45 : 1)
            }
        }
    }

    private var eventActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("This event is", selection: $event) {
                Text("Choose event").tag("")
                ForEach(EventCatalog.fallback, id: \.self) { Text($0).tag($0) }
            }
            .tint(Theme.green)
            HStack(spacing: 10) {
                SecondaryButton(title: "Don't score", systemImage: "nosign") {
                    Task { await store.perform(["type": "confirmMatch", "unmatchedId": item.id, "event": "IGNORE"], success: "Event ignored") }
                }
                PrimaryButton(title: "Confirm", systemImage: "checkmark") {
                    Task { await store.perform(["type": "confirmMatch", "unmatchedId": item.id, "event": event], success: "Event mapped") }
                }
                .disabled(event.isEmpty)
                .opacity(event.isEmpty ? 0.45 : 1)
            }
        }
    }
}

// MARK: - Draft rankings (ADP)

struct AdpReviewView: View {
    @Environment(AppStore.self) private var store
    @State private var showEditor: Bool = false
    @State private var text: String = ""
    @State private var resolving: AdpEntry?
    @State private var pick: [String] = []

    var body: some View {
        List {
            if let league = store.league {
                let entries = league.adpReview ?? []
                let flagged = entries.filter(\.needsReview).count
                Section {
                    Text(flagged == 0 ? "Every ranked name matches an athlete." : "\(flagged) name\(flagged == 1 ? "" : "s") need review. Unmatched names are skipped. No new athletes are ever created.")
                        .font(.subheadline).foregroundStyle(flagged == 0 ? Theme.green : Theme.gold)
                        .listRowBackground(Theme.surface)
                } footer: {
                    Text("Sets the default order in the draft room and auto-pick. It doesn't affect scoring, eligibility or matchups. Athletes not listed follow afterward.")
                }
                Section("Rankings") {
                    ForEach(Array(entries.enumerated()), id: \.offset) { i, e in
                        HStack(spacing: 10) {
                            Text("\(i + 1)").font(Theme.score(16)).foregroundStyle(Theme.muted).frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.athleteId.flatMap { store.athlete($0)?.name } ?? e.name)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(e.athleteId == nil ? Theme.muted : .white)
                                if e.athleteId == nil || e.match != "exact" {
                                    Text("Ranked as “\(e.name)”").font(.caption).foregroundStyle(Theme.faint)
                                }
                            }
                            Spacer()
                            tag(e)
                            if league.phaseKind == .predraft, league.isCommissioner {
                                Menu {
                                    if e.match == "fuzzy", let id = e.athleteId {
                                        Button("Confirm \(store.athlete(id)?.name ?? "")", systemImage: "checkmark") { resolve(e, id) }
                                    }
                                    ForEach(e.candidates, id: \.self) { cid in
                                        Button(store.athlete(cid)?.name ?? cid) { resolve(e, cid) }
                                    }
                                    Button("Choose athlete…", systemImage: "magnifyingglass") {
                                        pick = []
                                        resolving = e
                                    }
                                    Button("Skip this name", systemImage: "xmark", role: .destructive) { resolve(e, "") }
                                } label: {
                                    Image(systemName: "ellipsis.circle").font(.title3).frame(width: 40, height: 40)
                                }
                            }
                        }
                        .listRowBackground(Theme.surface)
                    }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Draft Rankings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if store.league?.phaseKind == .predraft {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit List") {
                        text = (store.league?.adpReview ?? []).map(\.name).joined(separator: "\n")
                        showEditor = true
                    }
                }
            }
        }
        .sheet(item: $resolving) { e in
            AthletePickerSheet(title: "Match “\(e.name)”", multiple: false, selection: $pick)
                .environment(store)
                .preferredColorScheme(.dark)
                .onDisappear {
                    if let id = pick.first { resolve(e, id) }
                }
        }
        .sheet(isPresented: $showEditor) {
            NavigationStack {
                TextEditor(text: $text)
                    .font(.system(size: 15))
                    .padding(12)
                    .scrollContentBackground(.hidden)
                    .background(Theme.bg)
                    .navigationTitle("One name per line")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showEditor = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") {
                                let names = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                                Task { if await store.perform(["type": "setAdp", "names": names], success: "Rankings saved") { showEditor = false } }
                            }
                            .fontWeight(.bold)
                        }
                    }
            }
            .preferredColorScheme(.dark)
        }
    }

    private func resolve(_ e: AdpEntry, _ athleteId: String) {
        Task { await store.perform(["type": "resolveAdp", "name": e.name, "athleteId": athleteId], success: athleteId.isEmpty ? "Skipped" : "Matched") }
    }

    private func tag(_ e: AdpEntry) -> some View {
        let (text, color): (String, Color) = {
            switch e.match {
            case "exact": return ("EXACT", Theme.green)
            case "fuzzy": return ("REVIEW", Theme.gold)
            case "manual": return ("CONFIRMED", Theme.green)
            case "skipped": return ("SKIPPED", Theme.faint)
            default: return ("NOT FOUND", Theme.red)
            }
        }()
        return Text(text).font(.system(size: 9, weight: .heavy)).foregroundStyle(color)
    }
}

extension AdpEntry: Identifiable {
    var id: String { name }
}

// MARK: - Audit log

struct AuditLogView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        List {
            let entries = store.league?.audit ?? []
            if entries.isEmpty {
                EmptyStateView(icon: "doc.text.magnifyingglass", title: "No changes yet", message: "Every manual scoring change, match confirmation and meet action is recorded here.")
                    .listRowBackground(Color.clear)
            }
            ForEach(entries) { e in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(e.action.uppercased()).font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.green)
                        Spacer()
                        Text(Fmt.dateTime(e.at)).font(.caption2).foregroundStyle(Theme.faint)
                    }
                    Text(e.detail).font(.subheadline)
                    Text(e.actorName).font(.caption).foregroundStyle(Theme.muted)
                }
                .listRowBackground(Theme.surface)
            }
        }
        .screenBackground()
        .navigationTitle("Audit Log")
        .navigationBarTitleDisplayMode(.inline)
    }
}
