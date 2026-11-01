import SwiftUI

/// Commissioner-only: Health dashboard, Reconcile Scores, Notification log, Snapshots and configuration versions.
/// Every tool is read-only on the server except Restore (which snapshots first).
struct IntegrityView: View {
    @Environment(AppStore.self) private var store
    @State private var section: Section = .health
    @State private var health: HealthReport?
    @State private var recon: ReconcileReport?
    @State private var notes: NoteLogBody?
    @State private var snaps: [SnapshotMeta] = []
    @State private var versions: VersionsBody?
    @State private var isRunning: Bool = false
    @State private var restoreTarget: SnapshotMeta?

    enum Section: String, CaseIterable, Identifiable {
        case health = "Health", reconcile = "Reconcile", alerts = "Alerts", snapshots = "Snapshots", versions = "Versions"
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Tool", selection: $section) {
                    ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                switch section {
                case .health: healthView
                case .reconcile: reconcileView
                case .alerts: alertsView
                case .snapshots: snapshotsView
                case .versions: versionsView
                }
            }
            .padding(16)
            .padding(.bottom, 30)
        }
        .background(TrackBackground())
        .navigationTitle("Scoring Integrity")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: section) { await load() }
        .refreshable { await load(force: true) }
        .confirmationDialog("Restore this snapshot?", isPresented: Binding(get: { restoreTarget != nil }, set: { if !$0 { restoreTarget = nil } }), titleVisibility: .visible) {
            Button("Restore", role: .destructive) {
                guard let t = restoreTarget else { return }
                Task {
                    if await store.perform(["type": "restoreSnapshot", "at": Int(t.at)], success: "Snapshot restored") { await load(force: true) }
                }
            }
        } message: {
            Text("This league's results and scoring go back to this copy. A snapshot of the current state is saved first, so this can be undone.")
        }
    }

    private func load(force: Bool = false) async {
        switch section {
        case .health: if force || health == nil { health = await store.tool(["op": "health"], as: HealthReport.self) }
        case .reconcile: break
        case .alerts: if force || notes == nil { notes = await store.tool(["op": "notelog"], as: NoteLogBody.self) }
        case .snapshots: snaps = await store.tool(["op": "snapshots"], as: SnapshotsBody.self)?.snapshots ?? []
        case .versions: if force || versions == nil { versions = await store.tool(["op": "versions"], as: VersionsBody.self) }
        }
    }

    // MARK: Health

    @ViewBuilder
    private var healthView: some View {
        if let h = health {
            card("ATHLETES", "person.3.fill") {
                stat("Master players", h.athletes.master)
                stat("Cornwall Central", h.athletes.cornwall)
                stat("Needs Review", h.athletes.needsReview, warn: h.athletes.needsReview > 0)
                stat("Unmatched (open)", h.athletes.unmatched, warn: h.athletes.unmatched > 0)
                stat("Possible duplicates", h.athletes.duplicateCandidates, warn: h.athletes.duplicateCandidates > 0)
                stat("Source ID conflicts", h.athletes.sourceConflicts, bad: h.athletes.sourceConflicts > 0)
                stat("Saved source IDs", h.athletes.sourceLinks)
                stat("Confirmed aliases", h.athletes.aliases)
                ForEach(h.athletes.duplicateExamples, id: \.self) { Text($0).font(.caption).foregroundStyle(Theme.gold) }
            }
            card("MEETS", "dot.radiowaves.left.and.right") {
                if h.meets.isEmpty { Text("No meets yet.").font(.caption).foregroundStyle(Theme.muted) }
                ForEach(h.meets) { m in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(m.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Spacer()
                            Text(m.live ? "LIVE" : m.status).font(.system(size: 10, weight: .heavy)).foregroundStyle(m.live ? Theme.red : Theme.muted)
                        }
                        Text(m.sourceStatus).font(.caption).foregroundStyle(m.sourceStatus == "OK" ? Theme.green : Theme.gold)
                        Text("W\(m.week) · \(m.events) events · \(m.results) results · \(m.scored) scored\(m.freshnessMin.map { " · read \($0) min ago" } ?? "")\(m.history ? " · history" : "")\(m.rehearsal ? " · rehearsal" : "")")
                            .font(.caption2).foregroundStyle(Theme.faint)
                    }
                    .padding(.vertical, 3)
                }
            }
            card("SCORING", "function") {
                stat("Results imported", h.scoring.imported)
                stat("Results scored", h.scoring.scored)
                stat("Scoring lines", h.scoring.lines)
                stat("Rejected / flagged", h.scoring.rejected, warn: h.scoring.rejected > 0)
                stat("Duplicates blocked", h.scoring.duplicatesBlocked)
                stat("Official corrections applied", h.scoring.corrections)
                stat("Simultaneous imports serialized", h.scoring.simultaneousImportsSerialized)
                HStack {
                    Text("Last reconcile").font(.subheadline)
                    Spacer()
                    if let m = h.scoring.mismatches {
                        Text(m == 0 ? "0 mismatches" : "\(m) mismatches").font(.subheadline.weight(.bold)).foregroundStyle(m == 0 ? Theme.green : Theme.red)
                    } else {
                        Text("Not run yet").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
                Text(h.scoring.versions).font(.caption).foregroundStyle(Theme.muted)
            }
            card("NOTIFICATIONS", "bell.badge.fill") {
                stat("Queued", h.notifications.queued)
                stat("Delivered", h.notifications.delivered)
                stat("No subscribed device", h.notifications.noDevices, warn: h.notifications.noDevices > 0)
                stat("Failed", h.notifications.failed, bad: h.notifications.failed > 0)
                stat("Duplicates blocked", h.notifications.duplicatesBlocked)
            }
            card("PROJECTIONS", "chart.line.uptrend.xyaxis") {
                stat("Generated", h.projections.generated)
                stat("Missing (no verified history)", h.projections.missing)
                stat("Errors", h.projections.errors, bad: h.projections.errors > 0)
                HStack {
                    Text("Stale").font(.subheadline)
                    Spacer()
                    Text(h.projections.stale ? "Yes (source down)" : "No").font(.subheadline.weight(.bold)).foregroundStyle(h.projections.stale ? Theme.gold : Theme.green)
                }
                if let v = h.projections.modelVersion { Text("Model \(v)").font(.caption).foregroundStyle(Theme.muted) }
            }
        } else {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(40)
        }
    }

    // MARK: Reconcile

    private var reconcileView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recomputes raw meet data → results → scoring engine → event totals → weekly totals → matchup totals, then compares with what's stored. Nothing is changed.")
                .font(.caption).foregroundStyle(Theme.muted)
            Button {
                Task { await runRecon(plant: false) }
            } label: {
                Label(isRunning ? "Reconciling…" : "Run Reconcile Scores", systemImage: "checkmark.shield")
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                    .background(Theme.green, in: .rect(cornerRadius: 14)).foregroundStyle(.black)
            }
            .disabled(isRunning)
            Button("Self-test: plant a problem in a copy") { Task { await runRecon(plant: true) } }
                .font(.footnote.weight(.semibold)).disabled(isRunning)
            if let r = recon {
                HStack(spacing: 10) {
                    Image(systemName: r.ok ? "checkmark.seal.fill" : "exclamationmark.octagon.fill").font(.title2)
                        .foregroundStyle(r.ok ? Theme.green : Theme.red)
                    Text(r.verdict).font(.subheadline.weight(.semibold))
                }
                .padding(12)
                .background((r.ok ? Theme.green : Theme.red).opacity(0.1), in: .rect(cornerRadius: 12))
                if let p = r.planted {
                    Text("Planted (copy only): removed \(p.removedResult ?? "—"); duplicated \(p.duplicatedLine ?? "—")").font(.caption).foregroundStyle(Theme.gold)
                }
                card("COUNTS", "number") {
                    stat("Results", r.counts.results)
                    stat("Scoring lines", r.counts.scoringLines)
                    stat("Player weeks", r.counts.playerWeeks)
                    stat("Multi-event player weeks", r.counts.multiEventPlayerWeeks)
                    stat("Line mismatches", r.counts.lineMismatches, bad: r.counts.lineMismatches > 0)
                    stat("Weekly total mismatches", r.counts.weeklyMismatches, bad: r.counts.weeklyMismatches > 0)
                    stat("Event-sum failures", r.counts.eventSumFailures, bad: r.counts.eventSumFailures > 0)
                    stat("Matchup mismatches", r.counts.matchupMismatches, bad: r.counts.matchupMismatches > 0)
                }
                ForEach(r.meets, id: \.meetId) { m in
                    Text("\(m.name): \(m.reread ? "\(m.sourceRows ?? 0) source rows · \(m.expected ?? 0) expected · \(m.stored ?? 0) stored · missing \(m.missing ?? 0) · orphaned \(m.orphaned ?? 0) · stale \(m.stale ?? 0)" : "couldn't re-read source")")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                if !r.issues.isEmpty {
                    card("ISSUES", "exclamationmark.triangle.fill") {
                        ForEach(Array(r.issues.enumerated()), id: \.offset) { _, i in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.kind.uppercased()).font(.system(size: 10, weight: .heavy)).foregroundStyle(i.severity == "mismatch" ? Theme.red : Theme.gold)
                                Text(i.detail).font(.caption)
                            }
                        }
                    }
                }
            }
        }
    }

    private func runRecon(plant: Bool) async {
        isRunning = true
        defer { isRunning = false }
        if let r = await store.tool(["op": "reconcile", "plant": plant], as: ReconcileReport.self) {
            withAnimation(.snappy) { recon = r }
            if r.ok { Haptics.success() } else { Haptics.warning() }
        }
    }

    // MARK: Alerts

    @ViewBuilder
    private var alertsView: some View {
        if let n = notes {
            Text("\(n.log.count) logged · \(n.duplicatesBlocked) duplicates blocked. Each notification has one delivery key, so retries never double-send.")
                .font(.caption).foregroundStyle(Theme.muted)
            ForEach(n.log) { l in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(l.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Spacer()
                        Text(statusLabel(l.status)).font(.system(size: 10, weight: .heavy)).foregroundStyle(statusColor(l.status))
                    }
                    Text("\(l.category.capitalized) · \(l.recipients) recipient\(l.recipients == 1 ? "" : "s") · \(l.attempts) attempt\(l.attempts == 1 ? "" : "s") · opens \(l.link) · \(Fmt.dateTime(l.createdAt))")
                        .font(.caption2).foregroundStyle(Theme.muted)
                    if let e = l.error, !e.isEmpty { Text(e).font(.caption2).foregroundStyle(Theme.faint).lineLimit(2) }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: .rect(cornerRadius: 12))
            }
        } else {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(40)
        }
    }

    private func statusLabel(_ s: String) -> String {
        switch s {
        case "delivered": return "DELIVERED"
        case "no-devices": return "NO DEVICE"
        case "failed": return "FAILED"
        case "skipped": return "ALERTS OFF"
        default: return "QUEUED"
        }
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "delivered": return Theme.green
        case "failed": return Theme.red
        case "no-devices", "skipped": return Theme.gold
        default: return Theme.muted
        }
    }

    // MARK: Snapshots

    private var snapshotsView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("A recoverable copy of this league's results and scoring is saved automatically before every reprocess, scoring change and restore.")
                .font(.caption).foregroundStyle(Theme.muted)
            Button {
                Task {
                    if await store.perform(["type": "snapshotNow", "reason": "Manual snapshot"], success: "Snapshot saved") { await load(force: true) }
                }
            } label: {
                Label("Save a snapshot now", systemImage: "externaldrive.badge.plus").font(.subheadline.weight(.semibold))
            }
            if snaps.isEmpty { Text("No snapshots yet.").font(.caption).foregroundStyle(Theme.faint) }
            ForEach(snaps) { s in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.reason).font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text("\(Fmt.dateTime(s.at)) · \(s.results) results · \(Fmt.short(s.points)) pts").font(.caption2).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Button("Restore") { restoreTarget = s }.font(.caption.weight(.bold)).foregroundStyle(Theme.gold)
                }
                .padding(10)
                .background(Theme.surface, in: .rect(cornerRadius: 12))
            }
        }
    }

    // MARK: Versions

    @ViewBuilder
    private var versionsView: some View {
        if let v = versions {
            if let c = v.current {
                Text("In force now: \(c.label)").font(.headline).foregroundStyle(Theme.green)
            }
            card("SCORING RULE VERSIONS", "slider.horizontal.3") {
                ForEach(v.rules, id: \.version) { r in
                    HStack {
                        Text("v\(r.version)").font(.subheadline.weight(.bold).monospacedDigit())
                        Text(r.since > 0 ? Fmt.dateTime(r.since) : "Original").font(.caption).foregroundStyle(Theme.muted)
                        Spacer()
                        Text(r.by ?? "").font(.caption).foregroundStyle(Theme.muted)
                    }
                }
            }
            card("TABLE VERSIONS", "chart.bar.xaxis") {
                ForEach(v.tables, id: \.version) { t in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("v\(t.version) · \(t.by)").font(.subheadline.weight(.semibold))
                        Text("\(Fmt.dateTime(t.at)) · \(t.detail)").font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
            }
            card("CHANGE LOG (OLD → NEW)", "clock.arrow.circlepath") {
                ForEach(Array(v.audit.enumerated()), id: \.offset) { _, a in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(a.actorName) · \(Fmt.dateTime(a.at))").font(.caption.weight(.semibold))
                        Text(a.detail).font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
            }
        } else {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(40)
        }
    }

    // MARK: Building blocks

    private func card<Content: View>(_ title: String, _ icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(.system(size: 11, weight: .heavy)).tracking(0.8).foregroundStyle(Theme.muted)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
    }

    private func stat(_ label: String, _ value: Int, warn: Bool = false, bad: Bool = false) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text("\(value)").font(.subheadline.weight(.bold).monospacedDigit())
                .foregroundStyle(bad ? Theme.red : warn ? Theme.gold : .white)
        }
    }
}
