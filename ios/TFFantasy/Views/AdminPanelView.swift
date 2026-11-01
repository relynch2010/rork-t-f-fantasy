import SwiftUI

/// Commissioner Admin Panel. Access is decided by the server on every request; this screen only shows its answers.
/// It reuses existing tools (scoring editor, meet center, results review, draft, waivers) instead of duplicating them.
struct AdminPanelView: View {
    @Environment(AppStore.self) private var store
    @State private var access: AdminAccess?
    @State private var loadFailed: Bool = false
    @State private var section: Section = .overview
    @State private var health: ProjHealthBody?
    @State private var data: DataValidation?
    @State private var versions: AdminVersions?
    @State private var log: AdminChangelog?
    @State private var busy: Bool = false
    @State private var serverMessage: String?
    @State private var zeroFilter: String = "all"
    @State private var restoreTarget: AdminVersionRow?
    @State private var restoreSource: String = "sandbox"
    @State private var typedConfirm: String = ""
    @State private var restoreRequestId: String = UUID().uuidString

    enum Section: String, CaseIterable, Identifiable {
        case overview = "Hub", projections = "Projections", data = "Data", history = "History"
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let access {
                    if access.allowed {
                        modeBanner(access)
                        Picker("Section", selection: $section) {
                            ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        if let serverMessage {
                            messageRow(serverMessage)
                        }
                        switch section {
                        case .overview: hub(access)
                        case .projections:
                            ProjectionMeetsSection(isGlobal: access.isGlobal)
                            projectionsView
                        case .data: dataView
                        case .history: historyView(access)
                        }
                    } else {
                        denied(access.reason)
                    }
                } else if loadFailed {
                    denied("Couldn't reach the server. Pull to try again.")
                } else {
                    ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(16)
            .padding(.bottom, 30)
        }
        .background(TrackBackground())
        .navigationTitle("Admin Panel")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .task { await loadAccess() }
        .task(id: section) { await load() }
        .refreshable { await loadAccess(); await load(force: true) }
        .alert("Type PUBLISH to restore", isPresented: Binding(get: { restoreTarget != nil }, set: { if !$0 { restoreTarget = nil; typedConfirm = "" } })) {
            TextField("PUBLISH", text: $typedConfirm)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) { typedConfirm = "" }
            Button("Restore", role: .destructive) { Task { await restore() } }
        } message: {
            Text("Version \(restoreTarget?.version ?? 0) becomes a new sandbox version in this test league only. Finished weeks keep their scores and history isn't rewritten.")
        }
    }

    // MARK: Loading

    private func loadAccess() async {
        let a = await store.tool(["op": "adminAccess"], as: AdminAccess.self)
        access = a
        loadFailed = a == nil
    }

    private func load(force: Bool = false) async {
        guard access?.allowed == true || access == nil else { return }
        switch section {
        case .overview: break
        case .projections: if force || health == nil { health = await store.tool(["op": "projHealth"], as: ProjHealthBody.self) }
        case .data: if force || data == nil { data = await store.tool(["op": "validateData"], as: DataValidation.self) }
        case .history:
            if force || versions == nil { versions = await store.tool(["op": "adminVersions"], as: AdminVersions.self) }
            if force || log == nil { log = await store.tool(["op": "changelog"], as: AdminChangelog.self) }
        }
    }

    private func refreshProjections() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if let h = await store.tool(["op": "projHealth", "refresh": true], as: ProjHealthBody.self) {
            health = h
            serverMessage = h.message
            Haptics.success()
        }
    }

    private func validate() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if let d = await store.tool(["op": "validateData"], as: DataValidation.self) {
            data = d
            serverMessage = d.note
            Haptics.success()
        }
    }

    private func loadIntoDraft(_ row: AdminVersionRow) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if let r = await store.tool(["op": "draftSave", "rules": encode(row.rules)], as: AdminResult.self) {
            serverMessage = r.message
            Haptics.success()
            log = await store.tool(["op": "changelog"], as: AdminChangelog.self)
        }
    }

    private func restore() async {
        guard let t = restoreTarget, typedConfirm == "PUBLISH", !busy else { return }
        busy = true
        defer { busy = false; typedConfirm = ""; restoreTarget = nil }
        let body: [String: Any] = ["op": "sandboxRestore", "version": t.version, "source": restoreSource, "confirm": "PUBLISH", "requestId": restoreRequestId]
        if let r = await store.tool(body, as: AdminResult.self) {
            serverMessage = r.message
            if r.ok, r.duplicate != true {
                restoreRequestId = UUID().uuidString
                Haptics.success()
                await store.fetchLeague(force: true)
            }
            versions = await store.tool(["op": "adminVersions"], as: AdminVersions.self)
            log = await store.tool(["op": "changelog"], as: AdminChangelog.self)
        }
    }

    // MARK: Hub

    private func modeBanner(_ a: AdminAccess) -> some View {
        HStack(spacing: 12) {
            Image(systemName: a.isGlobal ? "globe.americas.fill" : "testtube.2")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(a.isGlobal ? Theme.gold : Theme.flex)
                .frame(width: 40, height: 40)
                .background((a.isGlobal ? Theme.gold : Theme.flex).opacity(0.15), in: .rect(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.isGlobal ? "GLOBAL · EVERY LEAGUE" : "TEST LEAGUE · SANDBOX ONLY")
                    .font(.system(size: 11, weight: .heavy)).tracking(0.8)
                    .foregroundStyle(a.isGlobal ? Theme.gold : Theme.flex)
                Text(a.leagueName).font(.headline).foregroundStyle(.white)
                Text(a.reason).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .card(padding: 14)
    }

    @ViewBuilder
    private func hub(_ a: AdminAccess) -> some View {
        group("SCORING") {
            row(.adminScoring(a), "slider.horizontal.3", "Scoring rules", a.isGlobal ? "Draft → preview on real meets → type PUBLISH. PB-only rule and finished weeks stay fixed." : "Sandbox for this test league. The Main League never changes.", tint: Theme.gold)
            row(.scoringLab, "flask.fill", "Scoring Lab", "Compare rule ideas on real meets. Preview only")
            if a.isGlobal {
                row(.standards, "ruler", "Standards", "NB, Nike and States Super marks")
                row(.performanceTables, "chart.bar.xaxis", "Performance tables", "Time and mark point tiers")
            }
        }
        group("MEETS & RESULTS") {
            row(.meetCenter, "dot.radiowaves.left.and.right", "Meet Center", "Meets, scoring weeks, links and syncs")
            row(.unmatched, "person.fill.questionmark", "Unmatched results", "Athlete-event links waiting for review")
            row(.results, "list.bullet.rectangle", "Results & corrections", "Fixes go through the existing review and confirm flow")
            row(.integrity, "checkmark.shield.fill", "Scoring integrity", "Health, reconcile, snapshots")
        }
        group("LEAGUE") {
            row(.draft, "list.number", "Draft", "Order, start, results")
            row(.waivers, "tray.and.arrow.down.fill", "Waivers & free agents", "Claims and priority")
            row(.transactions, "arrow.left.arrow.right", "Transactions", "Every add, drop and trade")
            row(.schedule, "calendar", "Schedule", "Weeks and matchups")
            row(.editSettings, "gearshape.fill", "League settings", "Name, size, draft time")
        }
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(Theme.muted)
            Text(a.limits).font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 4)
    }

    // MARK: Projections

    @ViewBuilder
    private var projectionsView: some View {
        if let h = health {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    label("PROJECTION HEALTH", "waveform.path.ecg")
                    Spacer()
                    Text(h.modelVersion).font(.caption2.monospaced()).foregroundStyle(Theme.faint)
                }
                Text("Showing week \(h.targetWeek)\(h.targetWeek != h.currentWeek ? " (week \(h.currentWeek) is finished)" : "") · \(h.rules)")
                    .font(.caption).foregroundStyle(Theme.muted)
                stateGrid(h.targetWeekStates)
                stat("Athletes", h.athletes)
                stat("Expected points per meet available", h.outlookAvailable)
                Button {
                    Task { await refreshProjections() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.black) } else { Image(systemName: "arrow.clockwise") }
                        Text("Refresh projections now").fontWeight(.bold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.green, in: .rect(cornerRadius: 12))
                    .foregroundStyle(.black)
                }
                .buttonStyle(PressableStyle())
                .disabled(busy)
                Text("Refreshing recalculates from results, matches, meets, entries and scoring. It never changes real scores, and numbers can't be overridden by hand.")
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
            .card()
            zerosList(h)
        } else {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(.top, 40)
        }
    }

    private func stateGrid(_ states: [String: Int]) -> some View {
        let order = ["projected", "actual", "finished", "notEntered", "noMeet", "insufficient"]
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(order, id: \.self) { key in
                let n = states[key] ?? 0
                VStack(spacing: 2) {
                    Text("\(n)").font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundStyle(n == 0 ? Theme.faint : stateColor(key))
                    Text(ProjStateStyle.label(key)).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(Theme.surface2, in: .rect(cornerRadius: 10))
            }
        }
    }

    private func stateColor(_ s: String) -> Color {
        switch s {
        case "projected", "actual": return Theme.green
        case "insufficient": return Theme.gold
        case "notEntered": return Theme.red
        default: return Theme.muted
        }
    }

    @ViewBuilder
    private func zerosList(_ h: ProjHealthBody) -> some View {
        let states = Array(Set(h.zeros.map(\.state))).sorted()
        let shown = h.zeros.filter { zeroFilter == "all" || $0.state == zeroFilter }
        VStack(alignment: .leading, spacing: 10) {
            label("ZERO OR UNAVAILABLE · \(h.zeros.count)", "exclamationmark.magnifyingglass")
            if h.zeros.isEmpty {
                Text("Every athlete has a projection.").font(.caption).foregroundStyle(Theme.green)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        chip("all", "All")
                        ForEach(states, id: \.self) { chip($0, ProjStateStyle.label($0)) }
                    }
                }
                ForEach(shown.prefix(80)) { z in
                    Button {
                        store.sheet = .breakdown(z.athleteId, h.targetWeek)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(z.name).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(1)
                                if let team = z.team { Text(team).font(.caption2).foregroundStyle(Theme.faint).lineLimit(1) }
                                Spacer()
                                Text(z.label.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(stateColor(z.state))
                            }
                            Text(z.diagnosis).font(.caption).foregroundStyle(Theme.muted)
                            Text("\(z.resultsOnFile) results · \(z.pbsOnFile) PBs\(z.lastResult.map { " · last \($0)" } ?? "")\(z.outlookPerMeet.map { " · \(Fmt.short($0)) expected per meet" } ?? "")")
                                .font(.caption2).foregroundStyle(Theme.faint)
                        }
                        .padding(.vertical, 4)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Theme.line)
                }
                if shown.count > 80 { Text("Showing 80 of \(shown.count).").font(.caption2).foregroundStyle(Theme.faint) }
                Text("Tap an athlete for the full breakdown: data used, assumptions and point lines.").font(.caption2).foregroundStyle(Theme.faint)
            }
        }
        .card()
    }

    private func chip(_ key: String, _ title: String) -> some View {
        Button {
            withAnimation(.snappy) { zeroFilter = key }
        } label: {
            Text(title).font(.caption.weight(.semibold))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(zeroFilter == key ? Theme.green : Theme.surface2, in: .capsule)
                .foregroundStyle(zeroFilter == key ? .black : .white)
        }
        .buttonStyle(.plain)
    }

    // MARK: Data

    @ViewBuilder
    private var dataView: some View {
        if let d = data {
            VStack(alignment: .leading, spacing: 8) {
                label("RESULTS CHECK", "checklist")
                stat("Results on file", d.results)
                stat("Duplicate result keys", d.duplicateKeys, bad: d.duplicateKeys > 0)
                stat("Athletes needing review", d.needsReview.athletes, warn: d.needsReview.athletes > 0)
                stat("Marks needing review", d.needsReview.marks, warn: d.needsReview.marks > 0)
                stat("Saved athlete links", d.athleteLinks)
                stat("Link conflicts", d.linkConflicts, bad: d.linkConflicts > 0)
                Button {
                    Task { await validate() }
                } label: {
                    Label("Run validation again", systemImage: "checkmark.seal").font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(Theme.surface2, in: .rect(cornerRadius: 12))
                }
                .buttonStyle(PressableStyle())
                Text(d.note).font(.caption2).foregroundStyle(Theme.faint)
            }
            .card()
            VStack(alignment: .leading, spacing: 10) {
                label("MEETS · \(d.meets.count)", "calendar.badge.clock")
                if d.meets.isEmpty { Text("No meets yet.").font(.caption).foregroundStyle(Theme.muted) }
                ForEach(d.meets) { m in
                    NavigationLink(value: LeagueRoute.meet(m.id)) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Image(systemName: m.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill").foregroundStyle(m.ok ? Theme.green : Theme.gold)
                                Text(m.name).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(1)
                                Spacer()
                                Text("W\(m.week)").font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                            }
                            Text("\(m.date) · \(m.status) · \(m.results) results · \(m.scored) scored · \(m.entries) entries\(m.rehearsal ? " · test meet" : "")")
                                .font(.caption2).foregroundStyle(Theme.faint)
                            ForEach(m.problems, id: \.self) { Text($0).font(.caption).foregroundStyle(Theme.gold) }
                        }
                        .padding(.vertical, 3)
                    }
                    .buttonStyle(.plain)
                }
            }
            .card()
        } else {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(.top, 40)
        }
    }

    // MARK: History

    @ViewBuilder
    private func historyView(_ a: AdminAccess) -> some View {
        if let v = versions {
            VStack(alignment: .leading, spacing: 10) {
                label("LIVE NOW", "bolt.fill")
                Text(v.current.label).font(.subheadline.weight(.semibold))
                if !v.sandbox.isEmpty {
                    label("SANDBOX VERSIONS (THIS TEST LEAGUE)", "testtube.2")
                    ForEach(v.sandbox) { versionRow($0, source: "sandbox", a: a, isLive: $0.version == v.sandbox.first?.version) }
                }
                label("GLOBAL VERSIONS (EVERY LEAGUE)", "globe.americas.fill")
                ForEach(v.global.prefix(12)) { versionRow($0, source: "global", a: a, isLive: a.isGlobal && $0.version == v.global.first?.version) }
                Text(a.isGlobal
                     ? "Restoring loads an old version into your draft. Preview it, then publish with PUBLISH: it becomes a new version, history is never rewritten."
                     : "Restoring makes the old rules a new sandbox version in this test league. History is never rewritten.")
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
            .card()
        }
        if let l = log {
            VStack(alignment: .leading, spacing: 10) {
                label("CHANGE LOG", "clock.arrow.circlepath")
                if l.entries.isEmpty { Text("No changes yet.").font(.caption).foregroundStyle(Theme.muted) }
                ForEach(Array(l.entries.prefix(60).enumerated()), id: \.offset) { _, e in
                    HStack(alignment: .top, spacing: 10) {
                        Text(e.kind.uppercased())
                            .font(.system(size: 9, weight: .heavy))
                            .foregroundStyle(kindColor(e.kind))
                            .frame(width: 58, alignment: .leading)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.text).font(.caption).foregroundStyle(.white)
                            Text("\(e.by) · \(Fmt.ago(e.at)) · \(e.scope)").font(.caption2).foregroundStyle(Theme.faint)
                        }
                    }
                }
            }
            .card()
        }
        if versions == nil && log == nil {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(.top, 40)
        }
    }

    private func versionRow(_ r: AdminVersionRow, source: String, a: AdminAccess, isLive: Bool) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("v\(r.version)").font(.subheadline.weight(.heavy))
                    if isLive { Text("LIVE").font(.system(size: 9, weight: .heavy)).foregroundStyle(.black).padding(.horizontal, 5).padding(.vertical, 2).background(Theme.green, in: .capsule) }
                }
                Text("Participation \(Fmt.short(r.rules.participation)) · PB \(Fmt.short(r.rules.pb)) · SB \(Fmt.short(r.rules.sb)) · 1st \(Fmt.short(r.rules.overall.first ?? 0))")
                    .font(.caption2).foregroundStyle(Theme.muted)
                Text("\(r.note ?? "Published")\(r.by.map { " · \($0)" } ?? "") · \(Fmt.ago(r.since))").font(.caption2).foregroundStyle(Theme.faint)
            }
            Spacer()
            if !isLive {
                Button(a.isGlobal ? "Load as draft" : "Restore") {
                    if a.isGlobal {
                        Task { await loadIntoDraft(r) }
                    } else {
                        restoreSource = source
                        restoreTarget = r
                    }
                }
                .font(.caption.weight(.bold))
                .buttonStyle(.bordered)
                .tint(Theme.gold)
            }
        }
        .padding(.vertical, 3)
    }

    private func kindColor(_ k: String) -> Color {
        switch k {
        case "publish", "restore": return Theme.gold
        case "draft", "preview": return Theme.flex
        case "refresh", "validate": return Theme.green
        default: return Theme.muted
        }
    }

    // MARK: Building blocks

    private func denied(_ reason: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.shield.fill").font(.system(size: 40)).foregroundStyle(Theme.muted)
            Text("Not allowed").font(.title3.weight(.bold))
            Text(reason).font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private func messageRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "server.rack").foregroundStyle(Theme.green)
            Text(text).font(.caption).foregroundStyle(.white)
            Spacer(minLength: 0)
            Button { withAnimation { serverMessage = nil } } label: { Image(systemName: "xmark").font(.caption2) }
                .foregroundStyle(Theme.muted)
        }
        .padding(10)
        .background(Theme.greenDeep, in: .rect(cornerRadius: 12))
        .transition(.opacity)
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 11, weight: .heavy)).tracking(0.8).foregroundStyle(Theme.muted).padding(.bottom, 4)
            content()
        }
        .card(padding: 12)
    }

    private func row(_ route: LeagueRoute, _ icon: String, _ title: String, _ subtitle: String, tint: Color = Theme.green) -> some View {
        NavigationLink(value: route) {
            HStack {
                ToolRow(icon: icon, title: title, subtitle: subtitle, tint: tint)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.faint)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func label(_ text: String, _ icon: String) -> some View {
        Label(text, systemImage: icon).font(.system(size: 11, weight: .heavy)).tracking(0.6).foregroundStyle(Theme.muted)
    }

    private func stat(_ title: String, _ value: Int, warn: Bool = false, bad: Bool = false) -> some View {
        HStack {
            Text(title).font(.subheadline)
            Spacer()
            Text("\(value)").font(.subheadline.weight(.bold).monospacedDigit()).foregroundStyle(bad ? Theme.red : warn ? Theme.gold : .white)
        }
    }

    private func encode<T: Encodable>(_ value: T) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}
