import SwiftUI

/// Commissioner Scoring Lab: compares scoring options on this league's REAL AthleticLIVE results.
/// Read-only: nothing here changes rules, relays or finished weeks.
struct ScoringLabView: View {
    enum Tab: String, CaseIterable, Identifiable {
        case seeded = "Seeded / Unseeded"
        case relays = "Relays"
        case accuracy = "Projection Accuracy"
        var id: String { rawValue }
    }

    @Environment(AppStore.self) private var store
    @State private var tab: Tab = .seeded
    @State private var seed: SeedLabBody?
    @State private var relay: RelayLabBody?
    @State private var backtest: BacktestBody?
    @State private var isLoading: Bool = false

    private static let seedOrder: [String] = ["current", "neutral", "combined", "strength", "beatSeed"]
    private static let relayOrder: [String] = ["current", "divided", "full"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Lab", selection: $tab) {
                    ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                previewBanner
                switch tab {
                case .seeded: seedSection
                case .relays: relaySection
                case .accuracy: accuracySection
                }
            }
            .padding(16)
        }
        .background(TrackBackground())
        .navigationTitle("Scoring Lab")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: tab) { await loadIfNeeded() }
    }

    private var previewBanner: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "flask.fill").foregroundStyle(Theme.gold)
            Text("Preview only. Re-scores real past meets with each option. Nothing is published, and relay scoring and the schedule don't change until you approve.")
                .font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(12)
        .background(Theme.gold.opacity(0.08), in: .rect(cornerRadius: 12))
    }

    private func loadIfNeeded() async {
        switch tab {
        case .seeded where seed == nil: await run()
        case .relays where relay == nil: await run()
        case .accuracy where backtest == nil: await run()
        default: break
        }
    }

    private func run() async {
        isLoading = true
        defer { isLoading = false }
        switch tab {
        case .seeded: seed = await store.tool(["op": "seedLab"], as: SeedLabBody.self)
        case .relays: relay = await store.tool(["op": "relayLab"], as: RelayLabBody.self)
        case .accuracy: backtest = await store.tool(["op": "backtest"], as: BacktestBody.self)
        }
    }

    private var loading: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("Re-scoring real meets…").font(.caption).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }

    private func sourceLine(_ source: String?, _ notes: [String?]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let source { Label(source, systemImage: "checkmark.seal.fill").font(.caption.weight(.semibold)).foregroundStyle(Theme.green) }
            ForEach(notes.compactMap { $0 }, id: \.self) { Text($0).font(.caption2).foregroundStyle(Theme.faint) }
        }
    }

    // MARK: Seeded / unseeded

    @ViewBuilder
    private var seedSection: some View {
        if isLoading && seed == nil { loading }
        else if let s = seed, s.ok {
            sourceLine(s.source, [s.rulesVersion.map { "Rules in force: \($0)" }, s.seasonNote, s.contestsNote])
            if let st = s.sectionStats {
                VStack(alignment: .leading, spacing: 6) {
                    Text("What the data shows").font(.headline)
                    Text("\(st.sectioned) results came from events the meet split into Seeded and Unseeded sections (\(st.seededSection) seeded, \(st.unseededSection) unseeded). Each section was ranked on its own, so an unseeded-section winner gets 1st-place points.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                    if let r = s.fairnessRule { Text(r).font(.caption2).foregroundStyle(Theme.faint) }
                }
                .card()
            }
            ForEach(Self.seedOrder, id: \.self) { key in
                if let f = s.formulas?[key] { formulaCard(key, f, flips: s.matchupFlipsVsCurrent?[key] ?? 0) }
            }
            if let ex = s.fairnessExamples, !ex.isEmpty { examplesCard(ex) }
            if let m = s.matchups, !m.isEmpty { matchupsCard(m, keys: Self.seedOrder, names: s.formulas?.mapValues(\.name) ?? [:]) }
            if let a = s.athletes, !a.isEmpty { athletesCard(a, keys: Self.seedOrder, title: "Player totals per meet") }
            approvalNote("Tell me which formula to publish. It goes out as a new scoring version from the Main League, and finished weeks keep their scores.")
        } else if let s = seed {
            EmptyStateView(icon: "flask", title: "Not enough data", message: s.message ?? "Import a past meet first.")
        }
        rerun
    }

    private func formulaCard(_ key: String, _ f: LabFormula, flips: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(f.name).font(.headline)
                Spacer()
                if key == "current" { Text("NOW").font(.system(size: 9, weight: .heavy)).foregroundStyle(.black).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.muted, in: .capsule) }
            }
            Text(f.math).font(.caption).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 0) {
                metric("Avg seeded", f.avgSeededMeet.map(Fmt.pts) ?? "–")
                metric("Avg unseeded", f.avgUnseededMeet.map(Fmt.pts) ?? "–")
                metric("Unfair cases", "\(f.fairnessViolations ?? 0)", tint: (f.fairnessViolations ?? 0) == 0 ? Theme.green : Theme.gold)
                metric("Matchups flip", "\(flips)", tint: flips > 0 ? Theme.gold : .white)
            }
        }
        .card()
    }

    private func examplesCard(_ ex: [FairExample]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Real cases under current rules").font(.headline)
            ForEach(Array(ex.prefix(5).enumerated()), id: \.offset) { _, e in
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(e.event) · \(e.meet)").font(.caption.weight(.bold))
                    Text("Unseeded \(e.unseeded.name): \(e.unseeded.mark)\(e.unseeded.place.map { ", \($0)th in section" } ?? "") → \(Fmt.pts(e.unseeded.points)) pts")
                        .font(.caption).foregroundStyle(Theme.gold)
                    Text("Seeded \(e.seeded.name): \(e.seeded.mark)\(e.seeded.place.map { ", \($0)th in section" } ?? "") → \(Fmt.pts(e.seeded.points)) pts")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
            }
        }
        .card()
    }

    // MARK: Relays

    @ViewBuilder
    private var relaySection: some View {
        if isLoading && relay == nil { loading }
        else if let r = relay, r.ok {
            sourceLine(r.source, [r.contestsNote])
            VStack(alignment: .leading, spacing: 8) {
                Text("How relay points work today").font(.headline)
                ForEach(r.howItWorks ?? [], id: \.self) { line in
                    Label(line, systemImage: "circle.fill").font(.caption).foregroundStyle(Theme.muted).labelStyle(BulletLabel())
                }
            }
            .card()
            ForEach(Self.relayOrder, id: \.self) { key in
                if let o = r.options?[key] {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(o.name).font(.headline)
                        Text(o.math).font(.caption).foregroundStyle(Theme.muted)
                        if key != "current" { Text("Matchups that flip vs today: \(r.matchupFlipsVsCurrent?[key] ?? 0)").font(.caption.weight(.semibold)).foregroundStyle((r.matchupFlipsVsCurrent?[key] ?? 0) > 0 ? Theme.gold : Theme.green) }
                    }
                    .card()
                }
            }
            if let relays = r.relays, !relays.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Real relays · points per leg").font(.headline)
                    ForEach(Array(relays.prefix(12).enumerated()), id: \.offset) { _, x in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text("\(x.gender == "G" ? "Girls" : "Boys") \(x.event)").font(.subheadline.weight(.semibold))
                                Spacer()
                                Text(x.place.map { "\($0)th" } ?? x.status).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                            }
                            Text("\(x.meet) · \(x.legs.joined(separator: ", "))").font(.caption2).foregroundStyle(Theme.faint).lineLimit(2)
                            HStack(spacing: 0) {
                                metric("Today", Fmt.pts(x.perLeg.current))
                                metric("Divided ÷\(x.divisor)", Fmt.pts(x.perLeg.divided))
                                metric("Full", Fmt.pts(x.perLeg.full))
                            }
                        }
                        RowDivider(inset: 0)
                    }
                }
                .card()
            }
            if let m = r.matchups, !m.isEmpty { matchupsCard(m, keys: Self.relayOrder, names: r.options?.mapValues(\.name) ?? [:]) }
            if let a = r.athletes, !a.isEmpty { athletesCard(a, keys: Self.relayOrder, title: "Relay runners · total points") }
            approvalNote("Relay scoring stays exactly as it is until you pick option 1, 2 or 3.")
        } else if let r = relay {
            EmptyStateView(icon: "flask", title: "Not enough data", message: r.message ?? "Import a past meet first.")
        }
        rerun
    }

    // MARK: Accuracy

    @ViewBuilder
    private var accuracySection: some View {
        if isLoading && backtest == nil { loading }
        else if let b = backtest, b.ok {
            sourceLine("Model \(b.modelVersion ?? "") · \(b.samples ?? 0) athlete-meets across \(b.meetsTested ?? 0) past meets", [b.seasonNote])
            VStack(alignment: .leading, spacing: 10) {
                Text("Measured accuracy").font(.headline)
                if let e = b.withoutEntries { errRow("Events guessed from history", e) }
                if let e = b.withEntries { errRow("Events known in advance", e) }
                if let e = b.naiveLastMeet { errRow("Baseline: 'same as last meet'", e) }
                if let h = b.headToHead, let acc = h.accuracy {
                    HStack {
                        Text("Picks the higher scorer").font(.subheadline)
                        Spacer()
                        Text("\(Int((acc * 100).rounded()))%").font(Theme.score(20)).foregroundStyle(Theme.green)
                    }
                    Text("\(h.correct) of \(h.total) athlete pairs at the same meet").font(.caption2).foregroundStyle(Theme.faint)
                }
            }
            .card()
            if let per = b.perMeet, !per.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Meet by meet").font(.headline)
                    ForEach(per, id: \.date) { m in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(m.meet).font(.subheadline).lineLimit(1)
                                Text("\(Fmt.isoDay(m.date)) · \(m.athletes) athletes").font(.caption2).foregroundStyle(Theme.faint)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 1) {
                                Text("±\(Fmt.pts(m.mae))").font(.subheadline.weight(.bold).monospacedDigit())
                                Text("proj \(Int(m.projected)) / actual \(Int(m.actual))").font(.caption2).foregroundStyle(Theme.faint)
                            }
                        }
                    }
                }
                .card()
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(b.notes ?? [], id: \.self) { Text($0).font(.caption2).foregroundStyle(Theme.faint) }
            }
        } else if let b = backtest {
            EmptyStateView(icon: "chart.xyaxis.line", title: "Not enough data", message: b.message ?? "Needs at least two real meets.")
        }
        rerun
    }

    private func errRow(_ title: String, _ e: ErrStats) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title).font(.subheadline)
                Spacer()
                Text("±\(Fmt.pts(e.mae)) pts").font(Theme.score(20))
            }
            Text("Typical miss \(Fmt.pts(e.mae)) · bias \(Fmt.signed(e.bias)) · \(Int((e.coverage * 100).rounded()))% landed inside the projected range").font(.caption2).foregroundStyle(Theme.faint)
        }
    }

    // MARK: Shared

    private func matchupsCard(_ ms: [LabMatchup], keys: [String], names: [String: String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Played matchups, re-scored").font(.headline)
            ForEach(Array(ms.enumerated()), id: \.offset) { _, m in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(m.label): \(m.home) vs \(m.away)").font(.subheadline.weight(.semibold))
                    ForEach(keys, id: \.self) { k in
                        if let o = m.outcome(k) {
                            let flipped = k != "current" && o.winner != m.current?.winner
                            HStack {
                                Text(names[k] ?? k).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                                Spacer()
                                Text("\(Fmt.pts(o.home))–\(o.away.map(Fmt.pts) ?? "bye")").font(.caption.monospacedDigit())
                                Text(o.winner).font(.caption.weight(.bold)).foregroundStyle(flipped ? Theme.gold : .white).lineLimit(1).frame(width: 90, alignment: .trailing)
                            }
                        }
                    }
                }
                RowDivider(inset: 0)
            }
        }
        .card()
    }

    private func athletesCard(_ rows: [LabAthleteRow], keys: [String], title: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            ForEach(Array(rows.prefix(25).enumerated()), id: \.offset) { _, r in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(r.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                        if r.seeded == false { Text("UNSEEDED").font(.system(size: 8, weight: .heavy)).foregroundStyle(Theme.gold) }
                        Spacer()
                        if let meet = r.meet { Text(meet).font(.caption2).foregroundStyle(Theme.faint).lineLimit(1) }
                    }
                    HStack(spacing: 10) {
                        ForEach(keys, id: \.self) { k in
                            Text(Fmt.pts(r.value(k))).font(.caption.monospacedDigit())
                                .foregroundStyle(k == "current" ? .white : abs(r.value(k) - r.value("current")) < 0.01 ? Theme.muted : Theme.gold)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            HStack(spacing: 10) {
                ForEach(keys, id: \.self) { k in
                    Text(k == "beatSeed" ? "beat seed" : k).font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.faint).frame(maxWidth: .infinity)
                }
            }
        }
        .card()
    }

    private func metric(_ label: String, _ value: String, tint: Color = .white) -> some View {
        VStack(spacing: 2) {
            Text(value).font(Theme.score(18)).foregroundStyle(tint)
            Text(label).font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.faint).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private func approvalNote(_ text: String) -> some View {
        Label(text, systemImage: "hand.raised.fill").font(.caption).foregroundStyle(Theme.green)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.green.opacity(0.08), in: .rect(cornerRadius: 12))
    }

    private var rerun: some View {
        SecondaryButton(title: isLoading ? "Running…" : "Run again on the latest results", systemImage: "arrow.clockwise") {
            Task { await run() }
        }
        .disabled(isLoading)
    }
}

private struct BulletLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            configuration.icon.font(.system(size: 5))
            configuration.title
        }
    }
}
