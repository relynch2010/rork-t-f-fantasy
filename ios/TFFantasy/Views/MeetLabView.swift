import SwiftUI

// MARK: - Shared result summary (Test Connection + Test Lab)

/// PASS / WARNINGS / FAIL with the checks, what was found, and what's missing. Never a bare "connected".
struct LabSummaryCard: View {
    let result: MeetTestResult

    private var tint: Color {
        switch result.verdict {
        case "PASS": return Theme.green
        case "WARNINGS": return Theme.gold
        default: return Theme.red
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(result.verdict)
                    .font(.system(size: 12, weight: .heavy)).tracking(0.8)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(tint, in: .rect(cornerRadius: 6))
                if result.temporary == true {
                    Text("TEMPORARY").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.gold)
                }
                Spacer()
            }
            Text(result.message ?? result.error ?? "No details.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
            if let hint = result.hint {
                Text(hint).font(.caption).foregroundStyle(Theme.muted)
            }
            if let src = result.source, src.name != nil {
                VStack(alignment: .leading, spacing: 2) {
                    Text("SOURCE").font(.system(size: 10, weight: .heavy)).tracking(0.6).foregroundStyle(Theme.faint)
                    Text([src.name, src.date, src.location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.white)
                    if let type = src.sourceType { Text(type).font(.caption2).foregroundStyle(Theme.muted) }
                    if let id = src.meetId { Text("AthleticLIVE meet \(id)").font(.caption2.monospaced()).foregroundStyle(Theme.faint) }
                }
            }
            if let checks = result.checks, !checks.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(checks, id: \.name) { c in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: c.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                                .font(.system(size: 13)).foregroundStyle(c.ok ? Theme.green : Theme.red)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(c.name).font(.caption.weight(.semibold)).foregroundStyle(.white)
                                Text(c.detail).font(.caption2).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }
            if let caps = result.capabilities { CapabilityGrid(caps: caps) }
            if let w = result.warnings, !w.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(w.prefix(8).enumerated()), id: \.offset) { _, line in
                        Label(line, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption2).foregroundStyle(Theme.gold)
                    }
                }
            }
            if let steps = result.steps, !steps.isEmpty, result.verdict == "FAIL" {
                VStack(alignment: .leading, spacing: 3) {
                    Text("WHAT WAS TRIED").font(.system(size: 10, weight: .heavy)).tracking(0.6).foregroundStyle(Theme.faint)
                    ForEach(Array(steps.enumerated()), id: \.offset) { _, st in
                        Label("\(st.name): \(st.note)", systemImage: st.ok ? "checkmark" : "xmark")
                            .font(.caption2).foregroundStyle(st.ok ? Theme.muted : Theme.red)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Which datasets the source actually published.
struct CapabilityGrid: View {
    let caps: LabCapabilities

    var body: some View {
        let items: [(String, Bool)] = [
            ("Events", (caps.events ?? 0) > 0), ("Results", (caps.resultRows ?? 0) > 0), ("Schools", caps.schools ?? false),
            ("Athlete IDs", caps.athleteIds ?? false), ("Heats", caps.heats ?? false), ("Flights", caps.flights ?? false),
            ("Overall place", caps.overallPlaces ?? false), ("Heat place", caps.heatPlaces ?? false), ("Field marks", (caps.fieldEvents ?? 0) > 0),
            ("Attempts", caps.fieldAttempts ?? false), ("Relay legs", caps.relayLegs ?? false), ("PB / SB", caps.pbSb ?? false),
            ("Seeds", caps.seeds ?? false), ("Wind", caps.wind ?? false), ("Schedule", caps.schedule ?? false),
        ]
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(items, id: \.0) { item in
                HStack(spacing: 4) {
                    Image(systemName: item.1 ? "checkmark" : "minus").font(.system(size: 9, weight: .bold))
                    Text(item.0).font(.system(size: 11, weight: .semibold))
                }
                .foregroundStyle(item.1 ? Theme.green : Theme.faint)
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background((item.1 ? Theme.green : Theme.faint).opacity(0.12), in: .rect(cornerRadius: 6))
            }
        }
    }
}

// MARK: - Meet Test Lab

/// Main League commissioner: replays a past AthleticLIVE meet through the exact production importer and scoring
/// engine. Read-only; the server confirms every league is unchanged after each run.
struct MeetLabView: View {
    @Environment(AppStore.self) private var store
    @State private var url: String = ""
    @State private var repeatImport: Bool = true
    @State private var reconcile: Bool = true
    @State private var fault: String = ""
    @State private var isRunning: Bool = false
    @State private var result: MeetTestResult?
    @State private var filter: String = "cornwall"
    @State private var selected: LabEvidence?

    var body: some View {
        List {
            if store.league?.canEditGlobalSettings != true {
                Section { MainLeagueBanner(text: "The Meet Test Lab is for the Main League commissioner.") }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            } else {
                Section {
                    TextField("https://live.athletic.net/meets/…", text: $url, axis: .vertical)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(size: 15, weight: .medium).monospaced())
                        .lineLimit(1...3)
                    Toggle("Repeat import ×3", isOn: $repeatImport)
                    Toggle("Live → final check", isOn: $reconcile)
                    Picker("Simulate failure", selection: $fault) {
                        Text("None").tag("")
                        Text("Timeout").tag("timeout")
                        Text("Server error (5xx)").tag("5xx")
                        Text("Empty response").tag("empty")
                        Text("Incomplete results").tag("incomplete")
                    }
                    Button {
                        run()
                    } label: {
                        HStack {
                            Label("RUN TEST", systemImage: "testtube.2").font(.system(size: 15, weight: .heavy))
                            Spacer()
                            if isRunning { ProgressView() }
                        }
                    }
                    .disabled(isRunning || url.trimmingCharacters(in: .whitespaces).isEmpty)
                } header: {
                    Text("Past AthleticLIVE meet")
                } footer: {
                    Text("Runs the same import, matching and scoring as live meets, in a sandbox. Standings, rosters, matchups, waivers, trades and point totals are never touched.")
                }

                if let r = result {
                    Section { LabSummaryCard(result: r).listRowBackground(Theme.surface) }

                    if let iso = r.isolation {
                        Section {
                            Label(iso.unchanged ? "League data unchanged after the test" : "League data changed. Report this", systemImage: iso.unchanged ? "lock.shield.fill" : "exclamationmark.octagon.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(iso.unchanged ? Theme.green : Theme.red)
                                .listRowBackground(Theme.surface)
                        }
                    }

                    let tests: [(String, LabVerdict?)] = [("Repeat import", r.repeat), ("Live → final", r.reconcile), ("Failure handling", r.fault)]
                    if tests.contains(where: { $0.1 != nil }) {
                        Section("Acceptance tests") {
                            ForEach(tests.filter { $0.1 != nil }, id: \.0) { t in
                                let v = t.1?.verdict ?? ""
                                VStack(alignment: .leading, spacing: 2) {
                                    Label(t.0, systemImage: v.hasPrefix("PASS") ? "checkmark.seal.fill" : "xmark.octagon.fill")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(v.hasPrefix("PASS") ? Theme.green : Theme.red)
                                    Text(v).font(.caption).foregroundStyle(Theme.muted)
                                    if let m = t.1?.message { Text(m).font(.caption2).foregroundStyle(Theme.faint) }
                                }
                                .listRowBackground(Theme.surface)
                            }
                        }
                    }

                    if let c = r.counts {
                        Section("Import counts") {
                            count("Events", c.events)
                            count("Athletes (every school)", c.athletes)
                            count("Results", c.results)
                            count("Cornwall Central athletes", c.cornwall)
                            count("Matched to master players", c.matched)
                            count("Needs review", c.review, warn: true)
                            count("Source ID conflicts", c.conflicts, warn: true)
                            count("Not in player database", c.unmatched, warn: true)
                            count("Documents refused (other meet)", c.rejected, warn: true)
                            count("Duplicates prevented", c.duplicatesPrevented)
                            HStack {
                                Text("Fantasy points").foregroundStyle(Theme.muted)
                                Spacer()
                                Text(Fmt.short(c.points ?? 0)).font(Theme.score(18)).foregroundStyle(Theme.green)
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }

                    if let evidence = r.evidence, !evidence.isEmpty {
                        Section {
                            Picker("Show", selection: $filter) {
                                Text("Cornwall").tag("cornwall")
                                Text("Matched").tag("matched")
                                Text("Review").tag("review")
                            }
                            .pickerStyle(.segmented)
                            .listRowBackground(Color.clear)
                            ForEach(Array(filtered(evidence).enumerated()), id: \.offset) { _, e in
                                Button { selected = e } label: { EvidenceRow(e: e) }
                                    .listRowBackground(Theme.surface)
                            }
                        } header: {
                            Text("Athlete evidence")
                        } footer: {
                            Text("Tap a result for the source record, the match reason and every scoring line.")
                        }
                    }

                    if let events = r.events, !events.isEmpty {
                        Section("Events (\(events.count))") {
                            ForEach(Array(events.prefix(80).enumerated()), id: \.offset) { _, ev in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(ev.name).font(.subheadline.weight(.semibold)).foregroundStyle(ev.event == nil ? Theme.gold : .white)
                                    Text([
                                        ev.event ?? "Not recognized",
                                        ev.kind ?? "",
                                        (ev.heats ?? 0) > 1 ? "\(ev.heats ?? 0) \(ev.kind == "field" ? "flights" : "heats")" : "",
                                        "field \(ev.fieldSize ?? ev.rows)",
                                        (ev.cornwall ?? 0) > 0 ? "\(ev.cornwall ?? 0) Cornwall" : "",
                                        ev.complete ? "final" : "live",
                                    ].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(Theme.muted)
                                }
                                .listRowBackground(Theme.surface)
                            }
                        }
                    }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Meet Test Lab")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: Binding(get: { selected.map { EvidenceBox(e: $0) } }, set: { selected = $0?.e })) { box in
            EvidenceDetailView(e: box.e)
                .environment(store)
                .preferredColorScheme(.dark)
        }
    }

    private func filtered(_ list: [LabEvidence]) -> [LabEvidence] {
        switch filter {
        case "matched": return list.filter { $0.master != nil || !($0.relayMembers ?? []).isEmpty }
        case "review": return list.filter { ["review", "conflict", "none"].contains($0.match.type) }
        default: return list
        }
    }

    private func count(_ label: String, _ value: Int?, warn: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(Theme.muted)
            Spacer()
            Text("\(value ?? 0)")
                .font(.system(size: 16, weight: .bold).monospacedDigit())
                .foregroundStyle(warn && (value ?? 0) > 0 ? Theme.gold : .white)
        }
        .listRowBackground(Theme.surface)
    }

    private func run() {
        isRunning = true
        result = nil
        var body: [String: Any] = [
            "provider": "ATHLETICLIVE",
            "sourceUrl": url.trimmingCharacters(in: .whitespacesAndNewlines),
            "repeat": repeatImport,
            "reconcile": reconcile,
            "week": store.league?.week ?? 1,
        ]
        if !fault.isEmpty { body["fault"] = fault }
        Task {
            result = await store.meetLab(body)
            isRunning = false
            switch result?.verdict {
            case "PASS": Haptics.success()
            case "WARNINGS": Haptics.warning()
            default: Haptics.error()
            }
        }
    }
}

private struct EvidenceBox: Identifiable {
    let e: LabEvidence
    var id: String { "\(e.source.name)|\(e.result.sourceEvent)|\(e.scoring.resultId ?? "")" }
}

struct EvidenceRow: View {
    let e: LabEvidence

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            matchIcon
            VStack(alignment: .leading, spacing: 2) {
                Text(e.kind == "relay" ? e.source.name : e.source.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                Text(e.result.sourceEvent).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                Text(resultLine).font(.caption2.monospacedDigit()).foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.short(e.scoring.total)).font(Theme.score(18)).foregroundStyle(e.scoring.total > 0 ? Theme.green : Theme.muted)
                Text("pts").font(.caption2).foregroundStyle(Theme.faint)
            }
        }
        .padding(.vertical, 2)
    }

    private var resultLine: String {
        let r = e.result
        return [
            r.status != "OK" ? r.status : r.mark,
            r.place.map { "\(Fmt.ordinal($0)) overall" } ?? "",
            r.heatPlace.map { "\(Fmt.ordinal($0)) in \(r.type == "field" ? "flight" : "heat") \(r.heat ?? 0)" } ?? "",
            r.fieldSize.map { "field \($0)" } ?? "",
        ].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    @ViewBuilder private var matchIcon: some View {
        let (icon, tint): (String, Color) = {
            switch e.match.type {
            case "source_id", "mapping", "name_cornwall", "relay_members": return ("checkmark.circle.fill", Theme.green)
            case "conflict": return ("exclamationmark.octagon.fill", Theme.red)
            case "review": return ("questionmark.circle.fill", Theme.gold)
            default: return ("minus.circle", Theme.faint)
            }
        }()
        Image(systemName: icon).font(.system(size: 18)).foregroundStyle(tint).frame(width: 24)
    }
}

/// Source athlete → master player → result → every scoring line → raw source record.
struct EvidenceDetailView: View {
    let e: LabEvidence
    @Environment(\.dismiss) private var dismiss
    @State private var showRaw: Bool = false

    var body: some View {
        NavigationStack {
            List {
                Section("Source athlete") {
                    row("Name", e.source.name)
                    row("School", e.source.school ?? "—")
                    if let g = e.source.gender { row("Gender", g == "G" ? "Girls" : g == "B" ? "Boys" : g) }
                    if let gr = e.source.grade, !gr.isEmpty { row("Grade", gr) }
                    if let bib = e.source.bib, !bib.isEmpty { row("Bib", bib) }
                    if let sid = e.source.sourceId { row("Source athlete ID", sid) }
                    if let members = e.source.members, !members.isEmpty { row("Relay legs", members.joined(separator: ", ")) }
                }
                Section("Master player") {
                    if let m = e.master {
                        row("Player", m.name)
                        row("Master ID", m.id)
                        row("School", m.school ?? "Cornwall Central")
                    } else if let mem = e.relayMembers, !mem.isEmpty {
                        ForEach(mem, id: \.id) { m in row(m.name, "\(Fmt.short(m.total ?? 0)) pts") }
                    } else {
                        Text("No master player. No points are awarded.").foregroundStyle(Theme.muted).listRowBackground(Theme.surface)
                    }
                    row("Confidence", e.match.confidence.capitalized)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Reason").font(.caption).foregroundStyle(Theme.muted)
                        Text(e.match.reason).font(.subheadline)
                    }
                    .listRowBackground(Theme.surface)
                    if let c = e.match.candidates, !c.isEmpty { row("Candidates", c.map(\.name).joined(separator: ", ")) }
                }
                Section("Result") {
                    let r = e.result
                    row("Event", r.sourceEvent)
                    row("Scored as", [r.event ?? "Not recognized", r.type ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    row("Round", r.round == "PRELIM" ? "Prelim" : "Final")
                    row("Mark", r.mark.isEmpty ? "—" : r.mark)
                    row("Status", r.status)
                    row("Overall place", r.place.map { Fmt.ordinal($0) } ?? "—")
                    row(r.type == "field" ? "Flight" : "Heat", r.heat.map { "\($0) of \(r.heats ?? $0)" } ?? "—")
                    row(r.type == "field" ? "Flight place" : "Heat place", r.heatPlace.map { Fmt.ordinal($0) } ?? "—")
                    row("Field size (scored)", r.fieldSize.map(String.init) ?? "—")
                    if let ef = r.eventFieldSize, ef != r.fieldSize { row("Field size (this round)", "\(ef)") }
                    if let s = r.seedMark, !s.isEmpty { row("Seed", s) }
                    if let w = r.wind, !w.isEmpty { row("Wind", w) }
                    if let pb = r.sourcePb, !pb.isEmpty { row("PR before meet", pb) }
                    if let sb = r.sourceSb, !sb.isEmpty { row("SR before meet", sb) }
                    row("PB / SB", r.best == "PB" ? "Personal best" : r.best == "SB" ? "Season best" : r.best == "none" ? "Neither" : "Checked against history")
                    row("Official", r.sourceFinal == true ? "Final" : r.sourceFinal == false ? "Live / unofficial" : "Not stated")
                    if r.historyOnly == true { row("Counted", "No: same athlete ran the final") }
                }
                Section {
                    if e.scoring.lines.isEmpty {
                        Text("No fantasy points for this result.").foregroundStyle(Theme.muted).listRowBackground(Theme.surface)
                    }
                    ForEach(Array(e.scoring.lines.enumerated()), id: \.offset) { _, l in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(l.label)
                                Spacer()
                                Text(Fmt.signed(l.points)).font(.system(size: 15, weight: .bold).monospacedDigit()).foregroundStyle(l.points >= 0 ? Theme.green : Theme.red)
                            }
                            if let b = l.basis, !b.isEmpty {
                                Text(b + ((l.ver ?? "").isEmpty ? "" : " · \(l.ver ?? "")")).font(.caption2).foregroundStyle(Theme.muted)
                            }
                        }
                        .listRowBackground(Theme.surface)
                    }
                    HStack {
                        Text("Total").font(.headline)
                        Spacer()
                        Text(Fmt.short(e.scoring.total)).font(Theme.score(20)).foregroundStyle(Theme.green)
                    }
                    .listRowBackground(Theme.surface)
                } header: {
                    Text("Fantasy scoring")
                } footer: {
                    Text("Scoring version \(e.scoring.scoringVersion ?? 0). Same engine as live scoring. PB and SB never stack.")
                }
                if let raw = e.rawText {
                    Section("Source record") {
                        DisclosureGroup("Show raw source record", isExpanded: $showRaw) {
                            Text(raw).font(.system(size: 11).monospaced()).foregroundStyle(Theme.muted).textSelection(.enabled)
                        }
                        .listRowBackground(Theme.surface)
                    }
                }
            }
            .screenBackground()
            .navigationTitle(e.source.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(Theme.muted)
            Spacer(minLength: 12)
            Text(value).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
        .font(.system(size: 15))
        .listRowBackground(Theme.surface)
    }
}
