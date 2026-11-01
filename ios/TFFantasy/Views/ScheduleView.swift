import SwiftUI

/// Commissioner season schedule: every week, every matchup and bye, validation checks, and confirmed regenerate/edit.
/// Completed and started weeks are locked; nothing changes without explicit confirmation.
struct ScheduleView: View {
    @Environment(AppStore.self) private var store
    @State private var body_: ScheduleBody?
    @State private var isLoading: Bool = false
    @State private var seed: Int = 1
    @State private var confirmRegenerate: Bool = false
    @State private var editWeek: Int?
    @State private var confirmAdvance: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let s = body_ {
                    rhythmCard(s)
                    checksCard(s.checks, title: "Schedule checks")
                    if let p = s.preview { previewCard(s, p) }
                    actionsCard(s)
                    weeksList(s)
                    if !s.log.isEmpty { logCard(s) }
                } else if isLoading {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    EmptyStateView(icon: "calendar", title: "Schedule unavailable", message: "Pull to refresh.")
                }
            }
            .padding(16)
        }
        .background(TrackBackground())
        .navigationTitle("Season Schedule")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(preview: nil) }
        .task(id: store.league?.version) { await load(preview: nil) }
        .confirmationDialog("Regenerate open weeks?", isPresented: $confirmRegenerate, titleVisibility: .visible) {
            Button("Replace Weeks \(body_?.firstEditableWeek ?? 0)–\(body_?.regularWeeks ?? 0)", role: .destructive) {
                Task {
                    await store.perform(["type": "regenerateSchedule", "seed": seed, "confirm": true, "requestId": UUID().uuidString], success: "Schedule updated")
                    await load(preview: nil)
                }
            }
        } message: {
            Text("Completed and started weeks stay exactly as they are. Every manager is notified and the change is logged.")
        }
        .confirmationDialog("Show next week's matchup now?", isPresented: $confirmAdvance, titleVisibility: .visible) {
            Button("Activate now") {
                Task { await store.perform(["type": "startNextWeek", "requestId": UUID().uuidString], success: "Next week is live") }
            }
        } message: {
            Text("Normally the final result stays up until Monday 12:00 AM Eastern.")
        }
        .sheet(item: Binding(get: { editWeek.map { WeekRef(week: $0) } }, set: { editWeek = $0?.week })) { ref in
            if let s = body_ {
                WeekEditSheet(week: ref.week, teams: s.teams, games: s.schedule.filter { $0.week == ref.week && $0.kind == "regular" }) {
                    await load(preview: nil)
                }
                .environment(store)
                .preferredColorScheme(.dark)
            }
        }
    }

    private func load(preview: Int?) async {
        isLoading = true
        var req: [String: Any] = ["op": "schedule"]
        if let preview { req["seed"] = preview }
        if let out = await store.tool(req, as: ScheduleBody.self) { body_ = out }
        isLoading = false
    }

    private func name(_ id: String?, _ s: ScheduleBody) -> String {
        guard let id else { return "BYE" }
        return s.teams.first { $0.id == id }?.name ?? "Team"
    }

    private func rhythmCard(_ s: ScheduleBody) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WEEKLY RHYTHM · EASTERN TIME").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
            ForEach(s.rhythm, id: \.self) { line in
                Label(line, systemImage: "clock").font(.caption).foregroundStyle(Theme.muted)
            }
            HStack {
                Text("\(s.teams.count) teams · \(s.regularWeeks) regular weeks · \(s.playoffTeams)-team playoff")
                    .font(.subheadline.weight(.semibold))
                Spacer()
            }
            if let at = s.advanceAt {
                Text("Week \(s.currentWeek) is final. Week \(s.currentWeek + 1) activates \(Fmt.dateTime(at)).")
                    .font(.caption).foregroundStyle(Theme.green)
            }
        }
        .card()
    }

    private func checksCard(_ c: SchedChecks, title: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Text(c.ok ? "ALL PASS" : "NEEDS ATTENTION")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(c.ok ? Theme.green : Theme.gold)
            }
            ForEach(c.checks, id: \.name) { k in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: k.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(k.ok ? Theme.green : Theme.gold)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(k.name).font(.subheadline)
                        Text(k.detail).font(.caption).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .card()
    }

    private func actionsCard(_ s: ScheduleBody) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Change the schedule").font(.headline)
            Text(s.firstEditableWeek > s.regularWeeks ? "Every regular week has started. The schedule is locked." : "Weeks \(s.firstEditableWeek)–\(s.regularWeeks) can change. Earlier weeks are locked and never change.")
                .font(.caption).foregroundStyle(Theme.muted)
            if s.firstEditableWeek <= s.regularWeeks {
                HStack(spacing: 10) {
                    SecondaryButton(title: "Preview new rotation", systemImage: "shuffle") {
                        seed = Int.random(in: 1...999_999)
                        Task { await load(preview: seed) }
                    }
                }
            }
            if s.advanceAt != nil {
                SecondaryButton(title: "Activate Week \(s.currentWeek + 1) now", systemImage: "forward.end") { confirmAdvance = true }
            }
        }
        .card()
    }

    private func previewCard(_ s: ScheduleBody, _ p: SchedPreview) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("PREVIEW · NOT SAVED").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                Spacer()
                Text("\(p.changedGames) games change").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
            }
            ForEach(p.checks.checks, id: \.name) { k in
                Label(k.name, systemImage: k.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(k.ok ? Theme.green : Theme.gold)
            }
            ForEach(Array(Set(p.schedule.filter { $0.kind == "regular" && $0.week >= s.firstEditableWeek }.map(\.week))).sorted(), id: \.self) { w in
                VStack(alignment: .leading, spacing: 2) {
                    Text("Week \(w)").font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                    ForEach(p.schedule.filter { $0.week == w && $0.kind == "regular" }) { g in
                        Text("\(name(g.homeId, s)) vs \(name(g.awayId, s))").font(.caption)
                    }
                }
            }
            PrimaryButton(title: "Use this schedule", systemImage: "checkmark") { confirmRegenerate = true }
                .disabled(!p.checks.checks.prefix(3).allSatisfy(\.ok))
        }
        .card()
    }

    private func weeksList(_ s: ScheduleBody) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Set(s.schedule.map(\.week))).sorted(), id: \.self) { w in
                let games = s.schedule.filter { $0.week == w }
                let locked = games.allSatisfy { $0.locked ?? true }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(games.first?.round ?? "Week \(w)").font(.headline)
                        if w == s.currentWeek { Text("CURRENT").font(.system(size: 9, weight: .heavy)).foregroundStyle(.black).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.green, in: .capsule) }
                        Spacer()
                        if locked {
                            Label(games.allSatisfy(\.final) ? "Final" : "Locked", systemImage: "lock.fill").font(.caption).foregroundStyle(Theme.faint)
                        } else if games.first?.kind == "regular" {
                            Button("Edit") { editWeek = w }.font(.subheadline.weight(.semibold)).foregroundStyle(Theme.green)
                        }
                    }
                    ForEach(games) { g in
                        HStack {
                            Text(name(g.homeId, s)).font(.subheadline).lineLimit(1)
                            Spacer()
                            Text(g.awayId == nil ? "BYE" : "vs").font(.caption.weight(.heavy)).foregroundStyle(Theme.faint)
                            Spacer()
                            Text(g.awayId == nil ? "" : name(g.awayId, s)).font(.subheadline).lineLimit(1)
                        }
                    }
                }
                .card()
            }
        }
    }

    private func logCard(_ s: ScheduleBody) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Change history").font(.headline)
            ForEach(s.log, id: \.at) { l in
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.detail).font(.caption)
                    Text("\(l.by) · \(Fmt.dateTime(l.at))").font(.caption2).foregroundStyle(Theme.faint)
                }
            }
        }
        .card()
    }
}

private struct WeekRef: Identifiable {
    let week: Int
    var id: Int { week }
}

/// Pick each team's opponent for one open week. The server validates every team appears exactly once.
private struct WeekEditSheet: View {
    let week: Int
    let teams: [SchedTeam]
    let games: [SchedGame]
    let onDone: () async -> Void
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var pairs: [[String?]] = []
    @State private var confirm: Bool = false

    private var used: [String] { pairs.flatMap { $0.compactMap { $0 } } }
    private var isValid: Bool {
        let ids = used
        return Set(ids).count == ids.count && Set(ids) == Set(teams.map(\.id)) && pairs.allSatisfy { $0.first != nil }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(pairs.indices, id: \.self) { i in
                        HStack {
                            picker(i, 0)
                            Text("vs").foregroundStyle(Theme.faint)
                            picker(i, 1)
                        }
                    }
                } footer: {
                    Text(isValid ? "Every team appears exactly once." : "Each team must appear exactly once\(teams.count % 2 == 1 ? " (one bye)" : "").")
                }
            }
            .navigationTitle("Week \(week) matchups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { confirm = true }.disabled(!isValid) }
            }
            .confirmationDialog("Change Week \(week)?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Save matchups") {
                    Task {
                        let wire: [[Any]] = pairs.map { pair in pair.map { v -> Any in
                            if let v { return v }
                            return NSNull()
                        } }
                        let body: [String: Any] = ["type": "setWeekSchedule", "week": week, "confirm": true, "pairs": wire, "requestId": UUID().uuidString]
                        await store.perform(body, success: "Week \(week) updated")
                        await onDone()
                        dismiss()
                    }
                }
            } message: {
                Text("Every manager is notified and the change is logged.")
            }
            .onAppear {
                pairs = games.map { [$0.homeId, $0.awayId] }
            }
        }
    }

    private func picker(_ i: Int, _ side: Int) -> some View {
        Picker("", selection: Binding<String?>(get: { pairs[i][side] }, set: { pairs[i][side] = $0 })) {
            if side == 1 { Text("BYE").tag(String?.none) }
            ForEach(teams) { t in Text(t.name).tag(Optional(t.id)) }
        }
        .labelsHidden()
        .frame(maxWidth: .infinity)
    }
}
