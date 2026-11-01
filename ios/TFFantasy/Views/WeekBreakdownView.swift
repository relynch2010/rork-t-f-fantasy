import SwiftUI

/// Weekly proof for one athlete: every event they competed in, each with its full scoring evidence, summed into the
/// weekly total and the matchup contribution. All numbers come from the server's scoring engine.
struct WeekBreakdownView: View {
    let athleteId: String
    let week: Int

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var data: WeekBreakdown?
    @State private var isLoading: Bool = true
    @State private var expanded: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let data {
                        summary(data)
                        if data.events.isEmpty {
                            EmptyStateView(icon: "figure.run", title: "No events this week", message: "Nothing has been scored for \(data.name) in week \(data.week) yet.")
                        }
                        ForEach(Array(data.events.enumerated()), id: \.element.id) { i, e in
                            eventCard(index: i + 1, e)
                        }
                        totals(data)
                    } else if isLoading {
                        ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(40)
                    } else {
                        EmptyStateView(icon: "exclamationmark.triangle", title: "Couldn't load", message: "Pull to try again.")
                    }
                }
                .padding(16)
                .padding(.bottom, 30)
            }
            .background(Theme.bg)
            .navigationTitle("Week \(week) Proof")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: store.league?.version) {
                data = await store.weekBreakdown(athleteId, week: week)
                isLoading = false
            }
            .refreshable { data = await store.weekBreakdown(athleteId, week: week) }
        }
        .presentationDetents([.large])
        .presentationBackground(Theme.bg)
    }

    private func summary(_ d: WeekBreakdown) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                AthleteBadge(athlete: store.athlete(athleteId), size: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.name).font(.system(size: 20, weight: .bold))
                    Text("\(d.eventCount) event\(d.eventCount == 1 ? "" : "s") · every event counts").font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text(Fmt.short(d.weeklyTotal)).font(Theme.score(30)).foregroundStyle(Theme.green)
                    Text("WEEK \(d.week)").font(.system(size: 10, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
                }
            }
            checkBadge(d.check)
        }
    }

    private func checkBadge(_ c: BreakdownCheck) -> some View {
        HStack(spacing: 8) {
            Image(systemName: c.ok ? "checkmark.seal.fill" : "exclamationmark.octagon.fill")
                .foregroundStyle(c.ok ? Theme.green : Theme.red)
            Text(c.text).font(.system(size: 14, weight: .semibold).monospacedDigit())
            Spacer(minLength: 0)
        }
        .padding(10)
        .background((c.ok ? Theme.green : Theme.red).opacity(0.1), in: .rect(cornerRadius: 10))
    }

    private func eventCard(index: Int, _ e: BreakdownEvent) -> some View {
        let open = expanded.contains(e.id)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy) { if open { expanded.remove(e.id) } else { expanded.insert(e.id) } }
                Haptics.tap()
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    Text("EVENT \(index)").font(.system(size: 10, weight: .heavy)).tracking(1).foregroundStyle(Theme.faint)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(e.event).font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                            if e.relay { Text("RELAY").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.flex) }
                            if e.provisional { LiveStatusPill(status: "LIVE", compact: true) }
                        }
                        Text("\(e.meet) · \(Fmt.isoDay(e.date))").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Text(Fmt.signed(e.total)).font(Theme.score(22)).foregroundStyle(e.total < 0 ? Theme.red : Theme.green)
                    Image(systemName: "chevron.down").font(.caption.weight(.bold)).foregroundStyle(Theme.faint).rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            ForEach(Array(e.lines.enumerated()), id: \.offset) { _, l in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(l.label).font(.system(size: 14))
                        Spacer()
                        Text(Fmt.signed(l.points)).font(.system(size: 14, weight: .semibold).monospacedDigit()).foregroundStyle(l.points < 0 ? Theme.red : .white)
                    }
                    if open, let b = l.basis, !b.isEmpty {
                        Text(b).font(.caption2).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 5)
            }
            if open { evidence(e) }
            HStack {
                Text("Event total").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                Spacer()
                Text(Fmt.signed(e.total)).font(.system(size: 14, weight: .bold).monospacedDigit()).foregroundStyle(e.total < 0 ? Theme.red : Theme.green)
            }
            .padding(14)
        }
        .background(Theme.surface, in: .rect(cornerRadius: 16))
    }

    private func evidence(_ e: BreakdownEvent) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            RowDivider(inset: 0)
            row("Result ID", e.sourceResultId ?? e.resultId)
            if let id = e.eventId { row("Event ID", id) }
            if let round = e.round { row("Round", round == "PRELIM" ? "Prelims" : "Final") }
            if let h = e.heat { row(e.event.contains("Jump") || e.event.contains("Put") || e.event.contains("Throw") || e.event.contains("Vault") ? "Flight" : "Heat", "\(h)") }
            row("Overall place", e.place.map { Fmt.ordinal($0) } ?? "—")
            row("Heat / flight place", e.heatPlace.map { Fmt.ordinal($0) } ?? "—")
            row("Field size", e.fieldSize.map(String.init) ?? "—")
            row("Mark (source)", e.mark.original.isEmpty ? "—" : e.mark.original)
            if let v = e.mark.value { row("Normalized", "\(Fmt.short(v)) \(e.mark.unit) · \(e.mark.method)") }
            row("Status", e.status)
            row("PB / SB", e.pbsb == "none" ? "Neither" : e.pbsb)
            if let s = e.seedMark, !s.isEmpty { row("Seed", s) }
            if let season = e.season { row("Season tables", String(season)) }
            if let ver = e.lines.first?.ver, !ver.isEmpty { row("Versions", ver) }
            if let rt = e.relayTeam { row("Relay (fantasy)", rt) }
            if let c = e.corrections, !c.isEmpty {
                Text("\(c.count) earlier official version\(c.count == 1 ? "" : "s") kept for audit").font(.caption2.weight(.semibold)).foregroundStyle(Theme.gold)
                ForEach(Array(c.enumerated()), id: \.offset) { _, v in
                    Text("\(Fmt.dateTime(v.at)): \(v.status) \(v.mark.isEmpty ? "—" : v.mark) · place \(v.place.map(String.init) ?? "–") · heat \(v.heatPlace.map(String.init) ?? "–")")
                        .font(.caption2.monospacedDigit()).foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack(alignment: .top) {
            Text(k).font(.caption).foregroundStyle(Theme.muted)
            Spacer(minLength: 12)
            Text(v).font(.caption.weight(.semibold)).multilineTextAlignment(.trailing)
        }
    }

    private func totals(_ d: WeekBreakdown) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(d.events.enumerated()), id: \.element.id) { i, e in
                HStack {
                    Text("Event \(i + 1): \(e.event)").font(.subheadline)
                    Spacer()
                    Text(Fmt.signed(e.total)).font(.subheadline.monospacedDigit())
                }
            }
            RowDivider(inset: 0)
            HStack {
                Text("Total weekly player score").font(.headline)
                Spacer()
                Text(Fmt.short(d.weeklyTotal)).font(Theme.score(24)).foregroundStyle(Theme.green)
            }
            HStack {
                if let s = d.starter {
                    Text("Matchup contribution · \(s.teamName) (\(s.slot ?? "starter"))").font(.caption).foregroundStyle(Theme.muted)
                } else {
                    Text("Matchup contribution · not a starter this week").font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                Text(Fmt.short(d.matchupContribution)).font(.subheadline.weight(.bold).monospacedDigit())
            }
        }
        .padding(14)
        .background(Theme.surface2, in: .rect(cornerRadius: 16))
    }
}
