import SwiftUI

/// Yahoo-style fantasy points breakdown: every meet, event and scoring line with totals.
struct BreakdownView: View {
    let athleteId: String
    let week: Int?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var lines: [ScoreLine] = []
    @State private var isLoading: Bool = true
    @State private var selectedWeek: Int?

    var body: some View {
        NavigationStack {
            let shown = selectedWeek.map { w in lines.filter { $0.week == w } } ?? lines
            let groups = MeetGroup.group(shown)
            let total = shown.reduce(0) { $0 + $1.points }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header(total: total)
                    if let league = store.league {
                        ChipRow {
                            ChipButton(title: "Season", isOn: selectedWeek == nil) { selectedWeek = nil }
                            ForEach(1...max(1, min(league.week, max(1, league.totalWeeks))), id: \.self) { w in
                                ChipButton(title: league.weekLabel(w), isOn: selectedWeek == w) { selectedWeek = w }
                            }
                        }
                        .padding(.bottom, 14)
                    }
                    if let w = selectedWeek {
                        Button {
                            Haptics.tap()
                            store.sheet = .weekProof(athleteId, w)
                        } label: {
                            Label("Week \(w) proof: every event + weekly total", systemImage: "checkmark.seal")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(Theme.green.opacity(0.12), in: .rect(cornerRadius: 12))
                                .foregroundStyle(Theme.green)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }
                    if isLoading && lines.isEmpty {
                        ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(40)
                    } else if groups.isEmpty {
                        EmptyStateView(icon: "chart.bar.xaxis", title: "No points yet", message: selectedWeek == nil ? "Nothing scored this season yet." : "Nothing scored this week.")
                    } else {
                        ForEach(groups, id: \.id) { meet in
                            meetSection(meet)
                        }
                        HStack {
                            Text("Total").font(.system(size: 18, weight: .bold))
                            Spacer()
                            Text(Fmt.pts(total)).font(Theme.score(26)).foregroundStyle(total < 0 ? Theme.red : Theme.green)
                        }
                        .padding(16)
                    }
                }
                .padding(.bottom, 30)
            }
            .background(Theme.bg)
            .navigationTitle("Fantasy Points")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task(id: store.league?.version) {
                if selectedWeek == nil, isLoading { selectedWeek = week }
                lines = await store.lines(for: athleteId)
                isLoading = false
            }
        }
        .presentationDetents([.medium, .large])
        .presentationContentInteraction(.scrolls)
        .presentationBackground(Theme.bg)
    }

    private func header(total: Double) -> some View {
        let a = store.athlete(athleteId)
        return HStack(spacing: 12) {
            AthleteBadge(athlete: a, size: 50)
            VStack(alignment: .leading, spacing: 3) {
                Text(a?.name ?? "").font(.system(size: 20, weight: .bold))
                PosLabel(athlete: a, suffix: [a?.school, a?.gender.label].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " • "))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text(Fmt.pts(total)).font(Theme.score(30))
                Text(selectedWeek.map { "WEEK \($0)" } ?? "SEASON").font(.system(size: 10, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
            }
        }
        .padding(16)
    }

    private func meetSection(_ meet: MeetGroup) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(meet.meet).font(.system(size: 16, weight: .bold))
                    Text("\(Fmt.isoDay(meet.date)) • Week \(meet.week)").font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
                Spacer()
                Text(Fmt.pts(meet.total)).font(Theme.score(20))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(Theme.surface2)
            ForEach(meet.events, id: \.sourceId) { ev in
                VStack(spacing: 0) {
                    HStack(spacing: 6) {
                        Text(ev.event.uppercased()).font(.system(size: 13, weight: .heavy).width(.condensed)).foregroundStyle(Theme.muted)
                        if ev.lines.contains(where: { $0.provisional == true }) {
                            LiveStatusPill(status: "LIVE", compact: true)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 4)
                    if let detail = ev.lines.first?.detail, !detail.isEmpty {
                        Text(detail)
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 4)
                    }
                    ForEach(ev.lines) { line in
                        HStack {
                            Text(line.label).font(.system(size: 15))
                            Spacer()
                            Text(Fmt.signed(line.points))
                                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                                .foregroundStyle(line.points < 0 ? Theme.red : .white)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 34)
                    }
                    HStack {
                        Text("Event total").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                        Spacer()
                        Text(Fmt.signed(ev.total)).font(.system(size: 14, weight: .bold).monospacedDigit())
                            .foregroundStyle(ev.total < 0 ? Theme.red : Theme.green)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    RowDivider(inset: 16)
                }
                .background(Theme.surface)
            }
        }
        .padding(.bottom, 12)
    }
}
