import SwiftUI

/// Yahoo-style waivers: the next run countdown, my claims (drag to set order), and the league's priority list.
struct WaiversView: View {
    @Environment(AppStore.self) private var store
    @State private var order: [String] = []
    @State private var isEditing: Bool = false

    var body: some View {
        List {
            if let league = store.league {
                header(league)
                claimsSection(league)
                prioritySection(league)
            }
        }
        .environment(\.editMode, .constant(isEditing ? .active : .inactive))
        .screenBackground()
        .navigationTitle("Waivers")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if (store.league?.pendingClaims.count ?? 0) > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isEditing ? "Done" : "Reorder") {
                        if isEditing { Task { await saveOrder() } }
                        withAnimation(.snappy) { isEditing.toggle() }
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .onAppear { syncOrder() }
        .onChange(of: store.league?.version) { _, _ in if !isEditing { syncOrder() } }
    }

    private func syncOrder() {
        order = store.league?.pendingClaims.sorted { ($0.rank ?? 999, $0.createdAt) < ($1.rank ?? 999, $1.createdAt) }.map(\.id) ?? []
    }

    private func saveOrder() async {
        guard let league = store.league else { return }
        let current = league.pendingClaims.sorted { ($0.rank ?? 999, $0.createdAt) < ($1.rank ?? 999, $1.createdAt) }.map(\.id)
        guard order != current, order.count == current.count else { return }
        await store.perform(["type": "reorderClaims", "claimIds": order, "requestId": UUID().uuidString], success: "Claim order saved")
    }

    @ViewBuilder
    private func header(_ league: LeagueState) -> some View {
        Section {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let runAt = league.nextWaiverRun ?? 0
                let remaining = max(0, runAt / 1000 - (Date().timeIntervalSince1970 + store.clockOffset / 1000))
                VStack(alignment: .leading, spacing: 8) {
                    Text("NEXT WAIVER RUN")
                        .font(.system(size: 11, weight: .heavy)).tracking(1.2).foregroundStyle(Theme.gold)
                    Text(runAt > 0 ? Fmt.dateTime(runAt) : "Not scheduled")
                        .font(.system(size: 22, weight: .bold))
                    if runAt > 0 {
                        Text(countdown(remaining))
                            .font(.system(size: 34, weight: .heavy, design: .rounded).monospacedDigit())
                            .foregroundStyle(Theme.green)
                            .contentTransition(.numericText())
                    }
                    Text("Claims are due before the run. Waivers process every \(league.settings.waiverScheduleLabel). Players not claimed become free agents.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                .padding(.vertical, 6)
            }
            if let me = league.team(league.me) {
                HStack {
                    Label("Your priority", systemImage: "list.number")
                    Spacer()
                    Text(league.settings.isFAAB ? "$\(me.faab) budget" : "#\(me.waiverPriority) of \(league.teams.count)")
                        .font(.headline.monospacedDigit()).foregroundStyle(Theme.green)
                }
            }
        }
        .listRowBackground(Theme.surface)
    }

    @ViewBuilder
    private func claimsSection(_ league: LeagueState) -> some View {
        let byId = Dictionary(uniqueKeysWithValues: league.pendingClaims.map { ($0.id, $0) })
        let recent = league.claims.filter { $0.status != "pending" }.sorted { ($0.resolvedAt ?? 0) > ($1.resolvedAt ?? 0) }.prefix(8)
        Section {
            if order.isEmpty {
                Text("No pending claims. Find a player on waivers in Players and tap Claim.")
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
            ForEach(order, id: \.self) { id in
                if let c = byId[id] {
                    claimRow(c, index: (order.firstIndex(of: id) ?? 0) + 1, league: league)
                }
            }
            .onMove { from, to in order.move(fromOffsets: from, toOffset: to) }
        } header: {
            Text("My claims")
        } footer: {
            if order.count > 1 { Text("Your claims are tried top to bottom. Tap Reorder and drag to change the order.") }
        }
        .listRowBackground(Theme.surface)
        if !recent.isEmpty {
            Section("Recent results") {
                ForEach(Array(recent)) { c in
                    HStack(spacing: 12) {
                        AthleteBadge(athlete: store.athlete(c.addId), size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.athlete(c.addId)?.name ?? "Player").font(.subheadline.weight(.semibold))
                            if !c.reason.isEmpty { Text(c.reason).font(.caption).foregroundStyle(Theme.muted) }
                        }
                        Spacer()
                        Text(c.status == "won" ? "WON" : c.status == "lost" ? "LOST" : "CANCELLED")
                            .font(.caption.weight(.heavy))
                            .foregroundStyle(c.status == "won" ? Theme.green : c.status == "lost" ? Theme.red : Theme.muted)
                    }
                }
            }
            .listRowBackground(Theme.surface)
        }
    }

    private func claimRow(_ c: WaiverClaim, index: Int, league: LeagueState) -> some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(.system(size: 15, weight: .heavy).monospacedDigit())
                .foregroundStyle(Theme.gold)
                .frame(width: 22)
            AthleteBadge(athlete: store.athlete(c.addId), size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text("Add \(store.athlete(c.addId)?.name ?? "player")").font(.system(size: 15, weight: .semibold))
                Text([c.dropId.map { "Drop \(store.athlete($0)?.name ?? "player")" } ?? "No drop", league.settings.isFAAB ? "Bid $\(c.bid)" : nil].compactMap { $0 }.joined(separator: " • "))
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            if !isEditing {
                Button("Cancel") {
                    Task { await store.perform(["type": "cancelClaim", "claimId": c.id, "requestId": UUID().uuidString], success: "Claim cancelled") }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.red)
                .buttonStyle(.borderless)
            }
        }
        .frame(minHeight: 52)
    }

    @ViewBuilder
    private func prioritySection(_ league: LeagueState) -> some View {
        let ids = league.waiverPriorityOrder ?? league.teams.sorted { $0.waiverPriority < $1.waiverPriority }.map(\.id)
        Section {
            ForEach(Array(ids.enumerated()), id: \.element) { i, id in
                if let t = league.team(id) {
                    HStack(spacing: 12) {
                        Text("\(i + 1)").font(.headline.monospacedDigit()).foregroundStyle(Theme.muted).frame(width: 22)
                        TeamLogo(team: t, size: 30)
                        Text(t.teamName).font(.subheadline.weight(id == league.me ? .bold : .regular))
                            .foregroundStyle(id == league.me ? Theme.green : .white)
                        Spacer()
                    }
                }
            }
        } header: {
            Text("Waiver priority")
        } footer: {
            Text(league.settings.isFAAB ? "Highest bid wins; ties go to the higher priority." : "Rolling priority: starts in reverse draft order. Winning a claim moves you to the bottom.")
        }
        .listRowBackground(Theme.surface)
    }

    private func countdown(_ seconds: Double) -> String {
        let s = Int(seconds)
        let d = s / 86_400, h = (s % 86_400) / 3600, m = (s % 3600) / 60, sec = s % 60
        return d > 0 ? String(format: "%dd %02dh %02dm", d, h, m) : String(format: "%02d:%02d:%02d", h, m, sec)
    }
}
