import SwiftUI

/// Matchup total traced to every starter's complete weekly total (all events). Bench is shown but never counted.
struct TeamTraceView: View {
    let teamId: String
    let week: Int

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var data: TeamBreakdown?
    @State private var proofAthlete: String?

    var body: some View {
        NavigationStack {
            List {
                if let d = data {
                    Section {
                        HStack(spacing: 8) {
                            Image(systemName: d.check.ok ? "checkmark.seal.fill" : "exclamationmark.octagon.fill")
                                .foregroundStyle(d.check.ok ? Theme.green : Theme.red)
                            Text(d.check.text).font(.subheadline.weight(.semibold).monospacedDigit())
                        }
                        HStack {
                            Text("Matchup score").font(.headline)
                            Spacer()
                            Text(Fmt.short(d.matchupScore)).font(Theme.score(24)).foregroundStyle(Theme.green)
                        }
                    }
                    .listRowBackground(Theme.surface)
                    Section("Starters (count)") { ForEach(d.starters, id: \.slot) { row($0, counts: true) } }
                        .listRowBackground(Theme.surface)
                    Section("Bench (doesn't count)") { ForEach(d.bench, id: \.slot) { row($0, counts: false) } }
                        .listRowBackground(Theme.surface)
                } else {
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(data?.teamName ?? "Matchup total")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: store.league?.version) { data = await store.teamBreakdown(teamId, week: week) }
            .sheet(item: Binding(get: { proofAthlete.map { IdentifiedString(value: $0) } }, set: { proofAthlete = $0?.value })) { item in
                WeekBreakdownView(athleteId: item.value, week: week).environment(store).preferredColorScheme(.dark)
            }
        }
        .presentationDetents([.large])
    }

    private func row(_ r: TeamBreakdownRow, counts: Bool) -> some View {
        Button {
            if let id = r.athleteId { proofAthlete = id }
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(r.slot).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted).frame(width: 40, alignment: .leading)
                    Text(r.name ?? "Empty").foregroundStyle(r.name == nil ? Theme.faint : .white)
                    Spacer()
                    Text(Fmt.short(r.total)).font(.body.weight(.bold).monospacedDigit()).foregroundStyle(counts ? Theme.green : Theme.faint)
                }
                if !r.events.isEmpty {
                    Text(r.events.map { "\($0.event) \(Fmt.short($0.total))" }.joined(separator: " + "))
                        .font(.caption2).foregroundStyle(Theme.muted).padding(.leading, 40)
                }
            }
        }
        .disabled(r.athleteId == nil)
    }
}
